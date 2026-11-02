import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { ChatService } from '../../src/chat/chat.service';
import {
  bearer,
  createCustomer,
  createFeeRule,
  type TestCustomer,
  type TestDriver,
} from '../helpers/fixtures';
import { assignDriver, engine, registerBooking } from '../helpers/flows';
import { createHistoricalEligibleDriver } from '../helpers/onboarding-fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { restrictedDatabaseUrl } from '../setup/test-database';

describe('Active trip chat: real guards, PostgreSQL transactions and least privilege', () => {
  let owner: TestContext, app: TestContext, customer: TestCustomer, driver: TestDriver;
  beforeAll(async () => {
    owner = await createTestApp();
    app = await createTestApp({ databaseUrl: restrictedDatabaseUrl() });
    customer = await createCustomer({ ...owner, tokens: app.tokens });
    driver = await createHistoricalEligibleDriver({ ...owner, tokens: app.tokens });
    if (
      !(await owner.prisma.feeRule.findFirst({
        where: { category: 'MINI_TRUCK', effectiveTo: null },
      }))
    )
      await createFeeRule(owner.prisma, { category: 'MINI_TRUCK' });
  });
  afterAll(async () => {
    await app?.close();
    await owner?.close();
  });
  const messages = (id: string) => `/v1/bookings/${id}/chat/messages`;
  const send = (id: string, token = customer.token, key = randomUUID()) =>
    request(app.server)
      .post(messages(id))
      .set(bearer(token))
      .send({ text: 'Synthetic chat message', clientMessageId: key });
  async function conversation(assigned = true) {
    const id = await registerBooking(owner, customer, {
      category: 'MINI_TRUCK',
      paymentMethod: 'PAY_AT_DELIVERY',
      farePaise: 10000,
      model: 'QUOTE_PER_STOP',
    });
    return { id, tripId: assigned ? await assignDriver(owner, id, driver) : undefined };
  }
  it('requires verified authentication and confirmed assignment', async () => {
    const { id } = await conversation(false);
    await request(app.server).get(messages(id)).expect(401);
    const result = await send(id).expect(409);
    expect(result.body.error.code).toBe('CHAT_NOT_ASSIGNED');
    expect(await owner.prisma.chatMessage.count({ where: { bookingId: id } })).toBe(0);
  });
  it('delivers customer/driver messages through different backend references and persists read receipts', async () => {
    const { id, tripId } = await conversation();
    const sent = await send(id).expect(201);
    const route = `/v1/trips/${tripId}/chat`;
    const history = await request(app.server)
      .get(`${route}/messages`)
      .set(bearer(driver.token))
      .expect(200);
    expect(history.body).toEqual([sent.body]);
    await request(app.server).post(`${route}/read`).set(bearer(driver.token)).send({}).expect(200);
    const read = await request(app.server)
      .get(messages(id))
      .set(bearer(customer.token))
      .expect(200);
    expect(read.body[0]).toMatchObject({ id: sent.body.id, status: 'read' });
    await request(app.server)
      .post(`${route}/messages`)
      .set(bearer(driver.token))
      .send({ text: 'Driver response', clientMessageId: randomUUID() })
      .expect(201);
    expect(await owner.prisma.chatMessage.count({ where: { bookingId: id } })).toBe(2);
  });
  it('rejects other participants, engine IDs and untrusted attachments', async () => {
    const { id } = await conversation();
    const stranger = await createCustomer({ ...owner, tokens: app.tokens });
    await request(app.server).get(messages(id)).set(bearer(stranger.token)).expect(403);
    await send(id, stranger.token).expect(403);
    await request(app.server)
      .get(`/v1/trips/${randomUUID()}/chat/messages`)
      .set(bearer(driver.token))
      .expect(404);
    for (const body of [
      { text: 'Hello', imageUrl: 'https://untrusted.test/private.jpg' },
      { text: ' ' },
      { text: 'Hello', senderUserId: customer.userId },
    ]) {
      await request(app.server)
        .post(messages(id))
        .set(bearer(customer.token))
        .send(body)
        .expect(400);
    }
  });
  it('concurrent retries save exactly one row and reuse the same response', async () => {
    const { id } = await conversation(),
      key = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 4 }, () => send(id, customer.token, key).expect(201)),
    );
    expect(new Set(replies.map((reply) => reply.body.id)).size).toBe(1);
    expect(
      await owner.prisma.chatMessage.count({ where: { bookingId: id, clientMessageId: key } }),
    ).toBe(1);
    await request(app.server)
      .post(messages(id))
      .set(bearer(customer.token))
      .send({ text: 'Different content', clientMessageId: key })
      .expect(409);
  });
  it('closes read/send/read-receipt access immediately after cancellation', async () => {
    const { id, tripId } = await conversation();
    await send(id).expect(201);
    await engine(owner)
      .post(`/v1/internal/bookings/${id}/cancel`)
      .send({ reason: 'Disposable chat test cancellation' })
      .expect(200);
    await request(app.server).get(messages(id)).set(bearer(customer.token)).expect(410);
    await send(id).expect(410);
    await request(app.server)
      .post(`/v1/trips/${tripId}/chat/read`)
      .set(bearer(driver.token))
      .send({})
      .expect(410);
  });
  it('serializes concurrent chat writes with cancellation and denies every subsequent send', async () => {
    const { id } = await conversation();
    const replies = await Promise.all([
      ...Array.from({ length: 4 }, () => send(id)),
      engine(owner)
        .post(`/v1/internal/bookings/${id}/cancel`)
        .send({ reason: 'Concurrent synthetic chat cancellation' }),
    ]);
    for (const reply of replies.slice(0, -1)) expect([201, 410]).toContain(reply.status);
    expect(replies[replies.length - 1]!.status).toBe(200);
    await send(id).expect(410);
    await request(app.server).get(messages(id)).set(bearer(driver.token)).expect(410);
  });
  it('purges only closed conversations/alerts through EXECUTE without granting broad DELETE', async () => {
    const closed = await conversation(),
      active = await conversation();
    await send(closed.id).expect(201);
    await send(active.id).expect(201);
    await owner.prisma.inboxNotification.create({
      data: {
        userId: customer.userId,
        role: 'CUSTOMER',
        type: 'BOOKING_CANCELLED',
        title: 'Other alert',
        body: 'Preserved',
        data: { bookingId: closed.id },
      },
    });
    await engine(owner)
      .post(`/v1/internal/bookings/${closed.id}/cancel`)
      .send({ reason: 'Synthetic retention test' })
      .expect(200);
    const preservedAlerts = await owner.prisma.inboxNotification.count({
      where: { type: 'BOOKING_CANCELLED', data: { path: ['bookingId'], equals: closed.id } },
    });
    const before = {
      bookings: await owner.prisma.booking.count(),
      users: await owner.prisma.user.count(),
      wallet: await owner.prisma.driverWalletTransaction.count(),
      payments: await owner.prisma.payment.count(),
    };
    await expect(
      app.prisma.$executeRaw`DELETE FROM chat_messages WHERE booking_id=${closed.id}::uuid`,
    ).rejects.toThrow();
    expect(await app.app.get(ChatService).purgeClosedConversations()).toBeGreaterThan(0);
    expect(await owner.prisma.chatMessage.count({ where: { bookingId: closed.id } })).toBe(0);
    expect(await owner.prisma.chatMessage.count({ where: { bookingId: active.id } })).toBe(1);
    expect(
      await owner.prisma.inboxNotification.count({
        where: { type: 'NEW_CHAT_MESSAGE', data: { path: ['bookingId'], equals: closed.id } },
      }),
    ).toBe(0);
    expect(
      await owner.prisma.inboxNotification.count({
        where: { type: 'BOOKING_CANCELLED', data: { path: ['bookingId'], equals: closed.id } },
      }),
    ).toBe(preservedAlerts);
    expect({
      bookings: await owner.prisma.booking.count(),
      users: await owner.prisma.user.count(),
      wallet: await owner.prisma.driverWalletTransaction.count(),
      payments: await owner.prisma.payment.count(),
    }).toEqual(before);
    await expect(
      app.prisma.$queryRaw`SELECT public.purge_closed_chat_conversations(101)`,
    ).rejects.toThrow();
  });
});
