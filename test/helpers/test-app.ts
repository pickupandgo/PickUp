import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { SigningKeyProvider } from '../../src/auth/signing-key.provider';
import { configureApp } from '../../src/bootstrap/configure-app';
import { CollectionLinkGateway } from '../../src/collections/collection-link.gateway';
import { Clock } from '../../src/common/clock';
import type { AppConfig } from '../../src/config/app-config';
import { PayoutGateway } from '../../src/payouts/payout.gateway';
import { PrismaService } from '../../src/prisma/prisma.service';
import { RazorpayGateway } from '../../src/razorpay/razorpay.gateway';
import { SettlementGateway } from '../../src/settlements/settlement.gateway';
import { SimulatedSettlementGateway } from '../../src/settlements/simulated-settlement.gateway';
import { FakeClock } from './fake-clock';
import { FakeCollectionLinkGateway } from './fake-collection-link.gateway';
import { FakePayoutGateway } from './fake-payout.gateway';
import { FakeRazorpayGateway } from './fake-razorpay.gateway';
import { buildTestConfig } from './test-config';
import { StaticSigningKeyProvider, TestTokenIssuer } from './test-tokens';

export interface TestContext {
  readonly app: NestExpressApplication;
  readonly server: Server;
  readonly prisma: PrismaService;
  readonly razorpay: FakeRazorpayGateway;
  readonly links: FakeCollectionLinkGateway;
  readonly payouts: FakePayoutGateway;
  /** Razorpay settlement data: tests record a merchant settlement here, then run the sync. */
  readonly settlements: SimulatedSettlementGateway;
  readonly clock: FakeClock;
  readonly tokens: TestTokenIssuer;
  readonly config: AppConfig;
  close(): Promise<void>;
}

export interface TestAppOptions {
  readonly databaseUrl?: string;
  readonly configOverrides?: Record<string, string>;
}

/**
 * Boots the real application (same modules, guards, pipes and filters as production) against
 * the test database. Only the external seams are replaced: Razorpay, Razorpay collection links,
 * Razorpay settlement data and RazorpayX (in-memory fakes), the identity provider's public keys,
 * and the clock used for business schedules.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestContext> {
  const config = buildTestConfig({
    ...(options.databaseUrl ? { DATABASE_URL: options.databaseUrl } : {}),
    ...options.configOverrides,
  });
  const tokens = new TestTokenIssuer();
  const razorpay = new FakeRazorpayGateway();
  const links = new FakeCollectionLinkGateway();
  const payouts = new FakePayoutGateway();
  const settlements = new SimulatedSettlementGateway();
  const clock = new FakeClock();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] })
    .overrideProvider(SigningKeyProvider)
    .useValue(new StaticSigningKeyProvider(new Map([[tokens.kid, tokens.publicKey]])))
    .overrideProvider(RazorpayGateway)
    .useValue(razorpay)
    .overrideProvider(CollectionLinkGateway)
    .useValue(links)
    .overrideProvider(PayoutGateway)
    .useValue(payouts)
    .overrideProvider(SettlementGateway)
    .useValue(settlements)
    .overrideProvider(Clock)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    rawBody: true,
    logger: false,
  });
  configureApp(app, config);
  await app.init();

  return {
    app,
    server: app.getHttpServer(),
    prisma: app.get(PrismaService),
    razorpay,
    links,
    payouts,
    settlements,
    clock,
    tokens,
    config,
    close: () => app.close(),
  };
}
