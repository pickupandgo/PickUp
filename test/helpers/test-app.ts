import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { SigningKeyProvider } from '../../src/auth/signing-key.provider';
import type { EngineConfig } from '../../src/config/engine-config';
import { DriversService } from '../../src/drivers/drivers.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { FakePaymentBackend } from './fake-payment-backend';
import { buildTestConfig, TEST_INTERNAL_API_KEY } from './test-config';
import { StaticSigningKeyProvider, TestTokenIssuer } from './test-tokens';

export interface TestContext {
  readonly app: INestApplication;
  readonly server: Server;
  readonly prisma: PrismaService;
  readonly outbox: OutboxService;
  readonly drivers: DriversService;
  readonly backend: FakePaymentBackend;
  readonly tokens: TestTokenIssuer;
  readonly config: EngineConfig;
  /** Closes the engine only (a restart keeps the database and the payment backend). */
  closeEngine(): Promise<void>;
  /** Closes the engine and the fake payment backend. */
  close(): Promise<void>;
}

export interface TestAppOptions {
  /** Reuse a running fake backend (an engine restart against the same backend). */
  readonly backend?: FakePaymentBackend;
  readonly tokens?: TestTokenIssuer;
  readonly configOverrides?: Record<string, string>;
}

/**
 * Boots the real engine (same modules, global auth guard and services as production) against
 * the engine test database. Only the external seams are replaced: the payment backend (an
 * in-process HTTP fake that follows raj_backend's internal API rules) and Firebase's public
 * keys (a key generated for the run).
 */
export async function createTestApp(
  options: TestAppOptions = {},
): Promise<TestContext> {
  const backend =
    options.backend ?? (await FakePaymentBackend.start(TEST_INTERNAL_API_KEY));
  const tokens = options.tokens ?? new TestTokenIssuer();
  const config = buildTestConfig(backend.url, options.configOverrides);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register(config)],
  })
    .overrideProvider(SigningKeyProvider)
    .useValue(
      new StaticSigningKeyProvider(new Map([[tokens.kid, tokens.publicKey]])),
    )
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  // Listening (rather than init only) lets concurrent supertest requests share one server.
  await app.listen(0, '127.0.0.1');

  const ownsBackend = options.backend === undefined;
  return {
    app,
    server: app.getHttpServer() as Server,
    prisma: app.get(PrismaService),
    outbox: app.get(OutboxService),
    drivers: app.get(DriversService),
    backend,
    tokens,
    config,
    closeEngine: () => app.close(),
    close: async () => {
      await app.close();
      if (ownsBackend) {
        await backend.stop();
      }
    },
  };
}

/** Empties the engine tables between tests (TRUNCATE fires no row trigger). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE engine_outbox, engine_trips, engine_offers, engine_stops, engine_bookings
    RESTART IDENTITY CASCADE`;
}
