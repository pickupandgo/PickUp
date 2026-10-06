import { PrismaPg } from '@prisma/adapter-pg';
import request from 'supertest';
import { ProvisionUsageError } from '../../src/cli/provision-args';
import { runProvisionCommand } from '../../src/cli/provision-commands';
import { PrismaClient } from '../../src/generated/prisma/client';
import { bearer, idempotencyKey, uniquePhone, uniqueSubject } from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_DATABASE_URL } from '../setup/test-database';

describe('Provisioning CLI commands', () => {
  let ctx: TestContext;
  let owner: PrismaClient;

  beforeAll(async () => {
    ctx = await createTestApp();
    owner = new PrismaClient({
      adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL, max: 2 }),
    });
  });

  afterAll(async () => {
    await ctx.close();
    await owner.$disconnect();
  });

  it('creates an approved driver who can then sign in and top up', async () => {
    const subject = uniqueSubject('cli');
    const result = await runProvisionCommand(owner, 'firebase', {
      kind: 'create-driver',
      phone: uniquePhone(),
      subject,
      approve: true,
      legalName: 'Cli Test Driver',
    });
    expect(result).toMatchObject({ role: 'DRIVER', approvalStatus: 'APPROVED' });
    const driver = await owner.driver.findUniqueOrThrow({ where: { id: result.driverId ?? '' } });
    expect(driver.legalName).toBe('Cli Test Driver');

    const token = ctx.tokens.sign(subject);
    await request(ctx.server).get('/v1/wallet').set(bearer(token)).expect(200);
    await request(ctx.server)
      .post('/v1/wallet/topups')
      .set(bearer(token))
      .set('Idempotency-Key', idempotencyKey())
      .send({ amountPaise: 10_000 })
      .expect(201);
  });

  it('creates pending drivers that cannot top up until approved', async () => {
    const subject = uniqueSubject('cli');
    const phone = uniquePhone();
    await runProvisionCommand(owner, 'firebase', {
      kind: 'create-driver',
      phone,
      subject,
      approve: false,
      legalName: null,
    });
    const token = ctx.tokens.sign(subject);
    const topUp = () =>
      request(ctx.server)
        .post('/v1/wallet/topups')
        .set(bearer(token))
        .set('Idempotency-Key', idempotencyKey())
        .send({ amountPaise: 10_000 });

    await topUp().expect(403);
    const approved = await runProvisionCommand(owner, 'firebase', {
      kind: 'approve-driver',
      phone,
    });
    expect(approved.approvalStatus).toBe('APPROVED');
    await topUp().expect(201);
  });

  it('creates admins who can use admin routes but not driver routes', async () => {
    const subject = uniqueSubject('cli');
    await runProvisionCommand(owner, 'firebase', {
      kind: 'create-admin',
      phone: uniquePhone(),
      subject,
    });
    const token = ctx.tokens.sign(subject);
    await request(ctx.server)
      .get('/v1/admin/reconciliation/wallet-mismatches')
      .set(bearer(token))
      .expect(200);
    await request(ctx.server).get('/v1/wallet').set(bearer(token)).expect(403);
  });

  it('never re-links an existing phone or subject, and writes nothing on failure', async () => {
    const phone = uniquePhone();
    const subject = uniqueSubject('cli');
    await runProvisionCommand(owner, 'firebase', {
      kind: 'create-driver',
      phone,
      subject,
      approve: false,
      legalName: null,
    });

    await expect(
      runProvisionCommand(owner, 'firebase', {
        kind: 'create-admin',
        phone,
        subject: uniqueSubject('cli'),
      }),
    ).rejects.toBeInstanceOf(ProvisionUsageError);

    const otherPhone = uniquePhone();
    await expect(
      runProvisionCommand(owner, 'firebase', {
        kind: 'create-driver',
        phone: otherPhone,
        subject,
        approve: true,
        legalName: null,
      }),
    ).rejects.toThrow(/already linked/);
    expect(await owner.user.findUnique({ where: { phone: otherPhone } })).toBeNull();
  });

  it('records the KYC legal name with an audit entry', async () => {
    const phone = uniquePhone();
    const created = await runProvisionCommand(owner, 'firebase', {
      kind: 'create-driver',
      phone,
      subject: uniqueSubject('cli'),
      approve: true,
      legalName: null,
    });
    await runProvisionCommand(owner, 'firebase', {
      kind: 'set-legal-name',
      phone,
      legalName: 'Suresh Yadav',
    });
    const driver = await owner.driver.findUniqueOrThrow({ where: { id: created.driverId ?? '' } });
    expect(driver.legalName).toBe('Suresh Yadav');
    const audit = await owner.adminAction.findFirst({
      where: { action: 'DRIVER_LEGAL_NAME_SET', targetId: driver.id },
    });
    expect(audit?.details).toMatchObject({ previousLegalName: null, legalName: 'Suresh Yadav' });
    await expect(
      runProvisionCommand(owner, 'firebase', {
        kind: 'set-legal-name',
        phone: uniquePhone(),
        legalName: 'Nobody Here',
      }),
    ).rejects.toThrow(/No driver/);
  });

  it('refuses to approve someone who is not a driver', async () => {
    await expect(
      runProvisionCommand(owner, 'firebase', { kind: 'approve-driver', phone: uniquePhone() }),
    ).rejects.toThrow(/No driver/);
  });
});
