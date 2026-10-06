import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { ReconciliationService } from '../../src/reconciliation/reconciliation.service';
import { type LedgerEntryInput, WalletLedgerService } from '../../src/wallet/wallet-ledger.service';
import { WalletService } from '../../src/wallet/wallet.service';
import { createAdmin, createDriver, type TestAdmin } from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { TEST_DATABASE_URL } from '../setup/test-database';

/**
 * The wallet ledger engine against the real database. These are the release-blocking
 * financial integrity checks from the master prompt (section 18) that do not need HTTP.
 */
describe('Wallet ledger integrity', () => {
  let ctx: TestContext;
  let ledger: WalletLedgerService;
  let wallets: WalletService;
  let reconciliation: ReconciliationService;
  let admin: TestAdmin;

  beforeAll(async () => {
    ctx = await createTestApp();
    ledger = ctx.app.get(WalletLedgerService);
    wallets = ctx.app.get(WalletService);
    reconciliation = ctx.app.get(ReconciliationService);
    admin = await createAdmin(ctx);
  });

  afterAll(async () => {
    await ctx.close();
  });

  function post(input: Partial<LedgerEntryInput> & Pick<LedgerEntryInput, 'walletId'>) {
    return ctx.prisma.runInTransaction((tx) =>
      ledger.postEntry(tx, {
        type: 'CASH_RIDE_FEE',
        direction: 'DEBIT',
        amountPaise: 100n,
        referenceType: 'BOOKING',
        referenceId: randomUUID(),
        idempotencyKey: `test:${randomUUID()}`,
        ...input,
      }),
    );
  }

  function credit(walletId: string, amountPaise: bigint, idempotencyKey = `test:${randomUUID()}`) {
    return post({
      walletId,
      type: 'ADJUSTMENT',
      direction: 'CREDIT',
      amountPaise,
      referenceType: 'ADMIN',
      referenceId: admin.userId,
      performedByUserId: admin.userId,
      reason: 'Integration test funding',
      idempotencyKey,
    });
  }

  async function walletWithBalance(balancePaise: bigint): Promise<string> {
    const driver = await createDriver(ctx);
    const wallet = await wallets.ensureWalletForDriver(driver.driverId);
    if (balancePaise > 0n) {
      await credit(wallet.id, balancePaise);
    }
    return wallet.id;
  }

  async function balanceOf(walletId: string): Promise<bigint> {
    return (await ctx.prisma.driverWallet.findUniqueOrThrow({ where: { id: walletId } }))
      .balancePaise;
  }

  async function entriesOf(walletId: string) {
    return ctx.prisma.driverWalletTransaction.findMany({
      where: { walletId },
      orderBy: { walletVersion: 'asc' },
    });
  }

  it('#3 two simultaneous Rs 70 debits from Rs 100: exactly one succeeds', async () => {
    const walletId = await walletWithBalance(10_000n);

    const results = await Promise.allSettled([
      post({ walletId, amountPaise: 7_000n }),
      post({ walletId, amountPaise: 7_000n }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.reason).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
    expect(await balanceOf(walletId)).toBe(3_000n);
    expect((await entriesOf(walletId)).filter((e) => e.direction === 'DEBIT')).toHaveLength(1);
  });

  it('20 concurrent debits never overdraw and keep a gap-free ledger', async () => {
    const walletId = await walletWithBalance(10_000n);

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => post({ walletId, amountPaise: 1_000n })),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(10);
    expect(await balanceOf(walletId)).toBe(0n);
    const entries = await entriesOf(walletId);
    expect(entries.map((e) => Number(e.walletVersion))).toEqual(
      Array.from({ length: 11 }, (_, i) => i + 1),
    );
    expect(entries.at(-1)?.balanceAfterPaise).toBe(0n);
  });

  it('#4 an insufficient balance is rejected and nothing changes', async () => {
    const walletId = await walletWithBalance(5_000n);
    await expect(post({ walletId, amountPaise: 7_000n })).rejects.toMatchObject({
      code: 'INSUFFICIENT_BALANCE',
    });
    expect(await balanceOf(walletId)).toBe(5_000n);
    expect(await entriesOf(walletId)).toHaveLength(1);
  });

  it('a blocked wallet rejects debits but still accepts credits', async () => {
    const walletId = await walletWithBalance(5_000n);
    await ctx.prisma.driverWallet.update({ where: { id: walletId }, data: { status: 'BLOCKED' } });

    await expect(post({ walletId, amountPaise: 100n })).rejects.toMatchObject({
      code: 'WALLET_BLOCKED',
    });
    await credit(walletId, 1_000n);
    expect(await balanceOf(walletId)).toBe(6_000n);
  });

  it('replaying an idempotency key applies the entry once, even concurrently', async () => {
    const walletId = await walletWithBalance(10_000n);
    const idempotencyKey = `test:${randomUUID()}`;
    const referenceId = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        post({ walletId, amountPaise: 2_500n, idempotencyKey, referenceId }),
      ),
    );

    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(new Set(results.map((r) => r.entry.id)).size).toBe(1);
    expect(await balanceOf(walletId)).toBe(7_500n);
  });

  it('rejects reusing an idempotency key for a different amount', async () => {
    const walletId = await walletWithBalance(10_000n);
    const idempotencyKey = `test:${randomUUID()}`;
    await post({ walletId, amountPaise: 1_000n, idempotencyKey });
    await expect(post({ walletId, amountPaise: 2_000n, idempotencyKey })).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(await balanceOf(walletId)).toBe(9_000n);
  });

  it('#8 an error inside the transaction rolls back the balance and the ledger row', async () => {
    const walletId = await walletWithBalance(10_000n);
    const idempotencyKey = `test:${randomUUID()}`;

    await expect(
      ctx.prisma.runInTransaction(async (tx) => {
        await ledger.postEntry(tx, {
          walletId,
          type: 'CASH_RIDE_FEE',
          direction: 'DEBIT',
          amountPaise: 4_000n,
          referenceType: 'BOOKING',
          referenceId: randomUUID(),
          idempotencyKey,
        });
        throw new Error('simulated failure after the ledger write');
      }),
    ).rejects.toThrow('simulated failure');

    expect(await balanceOf(walletId)).toBe(10_000n);
    expect(await ctx.prisma.driverWalletTransaction.count({ where: { idempotencyKey } })).toBe(0);
  });

  it('#8 a backend connection killed mid-transaction rolls everything back', async () => {
    const walletId = await walletWithBalance(10_000n);
    const idempotencyKey = `test:${randomUUID()}`;
    const killer = new Client({ connectionString: TEST_DATABASE_URL });
    await killer.connect();

    try {
      await expect(
        ctx.prisma.runInTransaction(async (tx) => {
          await ledger.postEntry(tx, {
            walletId,
            type: 'CASH_RIDE_FEE',
            direction: 'DEBIT',
            amountPaise: 4_000n,
            referenceType: 'BOOKING',
            referenceId: randomUUID(),
            idempotencyKey,
          });
          const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
          // Simulates the database session dying before COMMIT (crash, network loss, failover).
          await killer.query('SELECT pg_terminate_backend($1)', [row?.pid]);
          await tx.$queryRaw`SELECT 1`;
        }),
      ).rejects.toBeDefined();
    } finally {
      await killer.end();
    }

    expect(await balanceOf(walletId)).toBe(10_000n);
    expect(await ctx.prisma.driverWalletTransaction.count({ where: { idempotencyKey } })).toBe(0);
  });

  it('#9 ledger rows cannot be updated, deleted or truncated', async () => {
    const walletId = await walletWithBalance(1_000n);
    const [entry] = await entriesOf(walletId);
    if (!entry) {
      throw new Error('expected a ledger entry');
    }

    await expect(
      ctx.prisma
        .$executeRaw`UPDATE driver_wallet_transactions SET amount_paise = 1 WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      ctx.prisma.$executeRaw`DELETE FROM driver_wallet_transactions WHERE id = ${entry.id}::uuid`,
    ).rejects.toThrow(/append-only/);
    // Refused by the trigger, or even earlier because cash collections reference ledger rows.
    await expect(ctx.prisma.$executeRaw`TRUNCATE driver_wallet_transactions`).rejects.toThrow(
      /append-only|referenced in a foreign key/,
    );

    const unchanged = await ctx.prisma.driverWalletTransaction.findUniqueOrThrow({
      where: { id: entry.id },
    });
    expect(unchanged.amountPaise).toBe(1_000n);
  });

  it('the database refuses two entries built on the same wallet version', async () => {
    const walletId = await walletWithBalance(1_000n);
    await expect(
      ctx.prisma.$executeRaw`
        INSERT INTO driver_wallet_transactions
          (wallet_id, type, direction, amount_paise, balance_after_paise, wallet_version,
           reference_type, reference_id, idempotency_key, performed_by_user_id, reason)
        VALUES (${walletId}::uuid, 'ADJUSTMENT', 'CREDIT', 500, 1500, 1,
                'ADMIN', 'x', ${`raw:${randomUUID()}`}, ${admin.userId}::uuid, 'version clash test')`,
    ).rejects.toThrow(/uq_wallet_tx_wallet_version|unique/i);
  });

  it('#7 the database refuses a second top-up credit for the same provider payment', async () => {
    const walletId = await walletWithBalance(0n);
    const insertTopUp = (version: number) => ctx.prisma.$executeRaw`
      INSERT INTO driver_wallet_transactions
        (wallet_id, type, direction, amount_paise, balance_after_paise, wallet_version,
         reference_type, reference_id, idempotency_key, provider, provider_order_id, provider_payment_id)
      VALUES (${walletId}::uuid, 'TOPUP', 'CREDIT', 500, 500, ${version},
              'RAZORPAY_PAYMENT', 'pay_DuplicateTest01', ${`raw:${randomUUID()}`},
              'RAZORPAY', 'order_DuplicateTest01', 'pay_DuplicateTest01')`;

    await insertTopUp(1);
    await expect(insertTopUp(2)).rejects.toThrow(/uq_wallet_tx_topup_provider_payment|unique/i);
  });

  it('the database refuses a negative balance even if a code path forgot to check', async () => {
    const walletId = await walletWithBalance(1_000n);
    await expect(
      ctx.prisma
        .$executeRaw`UPDATE driver_wallets SET balance_paise = -1 WHERE id = ${walletId}::uuid`,
    ).rejects.toThrow(/wallet_balance_nonnegative|check/i);
  });

  it('the database refuses adjustments without an admin and a reason', async () => {
    const walletId = await walletWithBalance(0n);
    await expect(
      ctx.prisma.$executeRaw`
        INSERT INTO driver_wallet_transactions
          (wallet_id, type, direction, amount_paise, balance_after_paise, wallet_version,
           reference_type, reference_id, idempotency_key)
        VALUES (${walletId}::uuid, 'ADJUSTMENT', 'CREDIT', 500, 500, 1, 'ADMIN', 'x', ${`raw:${randomUUID()}`})`,
    ).rejects.toThrow(/wallet_tx_adjustment_audit|check/i);
  });

  it('reconciliation is clean for ledger-driven wallets and flags a tampered balance', async () => {
    const healthy = await walletWithBalance(2_500n);
    await post({ walletId: healthy, amountPaise: 500n });
    const tampered = await walletWithBalance(2_500n);

    expect((await reconciliation.findWalletMismatches()).map((m) => m.walletId)).not.toContain(
      healthy,
    );

    // Someone edits a balance directly instead of posting a ledger entry.
    await ctx.prisma
      .$executeRaw`UPDATE driver_wallets SET balance_paise = 999999 WHERE id = ${tampered}::uuid`;
    const mismatches = await reconciliation.findWalletMismatches();
    expect(mismatches.find((m) => m.walletId === tampered)).toMatchObject({
      storedBalancePaise: 999_999,
      ledgerBalancePaise: 2_500,
    });
    expect(mismatches.map((m) => m.walletId)).not.toContain(healthy);
  });
});
