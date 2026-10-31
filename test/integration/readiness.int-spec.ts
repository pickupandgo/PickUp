import { createServer, connect, type Server, type Socket, type AddressInfo } from 'node:net';
import request from 'supertest';
import { bearer, createCustomer } from '../helpers/fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import { assertTestDatabase, TEST_DATABASE_URL } from '../setup/test-database';

/** Only this app's loopback connections are interrupted; PostgreSQL and other apps stay up. */
describe('Database readiness startup, transient network failure and recovery', () => {
  let ctx: TestContext;
  let proxy: Server;
  let unavailable = false;
  const sockets = new Set<Socket>();

  beforeAll(async () => {
    assertTestDatabase(TEST_DATABASE_URL);
    const target = new URL(TEST_DATABASE_URL);
    if (!['127.0.0.1', 'localhost'].includes(target.hostname)) {
      throw new Error('Readiness fault injection requires an isolated loopback test database');
    }
    const postgresHost = target.hostname;
    const postgresPort = Number(target.port || 5432);
    proxy = createServer((downstream) => {
      if (unavailable) {
        downstream.destroy();
        return;
      }
      const upstream = connect(postgresPort, postgresHost);
      for (const socket of [downstream, upstream]) {
        sockets.add(socket);
        socket.on('error', () => {
          downstream.destroy();
          upstream.destroy();
        });
        socket.on('close', () => sockets.delete(socket));
      }
      downstream.on('close', () => upstream.destroy());
      upstream.on('close', () => downstream.destroy());
      downstream.pipe(upstream).pipe(downstream);
    });
    await new Promise<void>((resolve, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', resolve);
    });
    target.hostname = '127.0.0.1';
    target.port = String((proxy.address() as AddressInfo).port);
    ctx = await createTestApp({
      databaseUrl: target.toString(),
      configOverrides: { DATABASE_POOL_MAX: '1' },
    });
  });

  afterAll(async () => {
    await ctx?.close();
    for (const socket of sockets) socket.destroy();
    if (proxy?.listening) await new Promise<void>((resolve) => proxy.close(() => resolve()));
  });

  it('initializes the actual Prisma/query/connection path before serving its first request', async () => {
    expect(ctx.prisma.poolSnapshot()).toMatchObject({ initialized: true, idle: 1 });
    expect(ctx.prisma.poolSnapshot().connectionsEstablished).toBeGreaterThanOrEqual(1);
    await request(ctx.server).get('/health/ready').expect(200, { status: 'ok' });
  });

  it('serves concurrent readiness probes through the normal database path', async () => {
    await Promise.all(
      Array.from({ length: 4 }, () =>
        request(ctx.server).get('/health/ready').expect(200, { status: 'ok' }),
      ),
    );
  });

  it('returns 503 during an actual connection outage, then restores readiness and customer access', async () => {
    const customer = await createCustomer(ctx);
    unavailable = true;
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await request(ctx.server).get('/health/live').expect(200, { status: 'ok' });
    const failed = await request(ctx.server).get('/health/ready').expect(503);
    expect(failed.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(failed.body)).not.toMatch(
      /postgres|connectionString|SELECT|127\.0\.0\.1/i,
    );
    // A timed-out underlying attempt must retire before a subsequent probe is created.
    await ctx.prisma.readiness().work.catch(() => undefined);
    unavailable = false;
    await request(ctx.server).get('/health/ready').expect(200, { status: 'ok' });
    const profile = await request(ctx.server)
      .get('/v1/customers/me')
      .set(bearer(customer.token))
      .expect(200);
    expect(profile.body.customerId).toBe(customer.customerId);
  });
});
