import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import request from 'supertest';
import { RemoteJwksKeyProvider, SigningKeyProvider } from '../../src/auth/signing-key.provider';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { buildTestConfig } from '../helpers/test-config';
import { TestTokenIssuer } from '../helpers/test-tokens';
import { createCustomer, createAdmin, createFeeRule, bearer } from '../helpers/fixtures';
import { createHistoricalEligibleDriver } from '../helpers/onboarding-fixtures';
import { createTestApp, type TestContext } from '../helpers/test-app';
import {
  bookedTrip,
  registerBooking,
  engine,
  fundWallet,
  setTripStatus,
  collect,
  deliverStops,
} from '../helpers/flows';

describe('Phase 2 readiness regression', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(async () => {
    await ctx?.close();
  });

  it('continues to reject an eligible driver whose verified vehicle category does not match', async () => {
    const customer = await createCustomer(ctx);
    const driver = await createHistoricalEligibleDriver(ctx);
    await createFeeRule(ctx.prisma, { category: 'FOUR_WHEELER', value: '10' });
    const bookingId = await registerBooking(ctx, customer, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50000,
      category: 'FOUR_WHEELER',
    });
    const response = await engine(ctx)
      .post(`/v1/internal/bookings/${bookingId}/assign`)
      .send({ driverSubject: driver.subject })
      .expect(422);
    expect(response.body.error.details.reasons).toContain('VEHICLE_CATEGORY_MISMATCH');
    expect(await ctx.prisma.trip.count({ where: { bookingId } })).toBe(0);
  });

  it('completes a matching-category synthetic cash trip without an external financial call', async () => {
    const customer = await createCustomer(ctx);
    const driver = await createHistoricalEligibleDriver(ctx);
    const admin = await createAdmin(ctx);
    await createFeeRule(ctx.prisma, { category: 'MINI_TRUCK', value: '10' });
    const { bookingId, tripId } = await bookedTrip(ctx, customer, driver, {
      paymentMethod: 'PAY_AT_PICKUP',
      farePaise: 50000,
      category: 'MINI_TRUCK',
    });
    await fundWallet(ctx, admin, driver.driverId, 10000);
    await setTripStatus(ctx, tripId, 'DRIVER_ARRIVED').expect(200);
    await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(409);
    await collect(ctx, driver, tripId, {
      method: 'CASH',
      amountPaise: 50000,
    }).expect(201);
    await setTripStatus(ctx, tripId, 'PICKUP_VERIFIED').expect(200);
    await setTripStatus(ctx, tripId, 'IN_TRANSIT').expect(200);
    await deliverStops(ctx, tripId, [1]);
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    await setTripStatus(ctx, tripId, 'COMPLETED').expect(200);
    expect(await ctx.prisma.driverEarning.count({ where: { bookingId } })).toBe(1);
    const wallet = await request(ctx.server)
      .get('/v1/wallet')
      .set(bearer(driver.token))
      .expect(200);
    expect(wallet.body.balancePaise).toBe(5000);
    await request(ctx.server)
      .get(`/v1/bookings/${bookingId}`)
      .set(bearer(customer.token))
      .expect(200);
  });

  it('fetches a real local JWKS and rejects another audience, issuer and an expired JWT', async () => {
    const tokens = new TestTokenIssuer();
    const jwk = {
      ...tokens.publicKey.export({ format: 'jwk' }),
      kid: tokens.kid,
      alg: 'RS256',
      use: 'sig',
    };
    const jwks: Server = createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'max-age=60',
      });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/jwks`;
    const config = buildTestConfig({
      AUTH_JWKS_URL: url,
      PAYOUT_PROVIDER: 'disabled',
      COLLECTION_LINK_PROVIDER: 'disabled',
      REFUND_PROVIDER: 'disabled',
      SETTLEMENT_PROVIDER: 'disabled',
    });
    const module = await Test.createTestingModule({
      imports: [AppModule.register(config)],
    })
      .overrideProvider(SigningKeyProvider)
      .useClass(RemoteJwksKeyProvider)
      .compile();
    const app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
      logger: false,
    });
    try {
      configureApp(app, config);
      await app.init();
      const customer = await createCustomer({ prisma: ctx.prisma, tokens });
      await request(app.getHttpServer())
        .get('/v1/customers/me')
        .set(bearer(customer.token))
        .expect(200);
      for (const options of [
        { audience: 'production' },
        { issuer: 'https://production.invalid' },
        { expiresInSeconds: -60 },
        { kid: 'untrusted' },
      ]) {
        await request(app.getHttpServer())
          .get('/v1/customers/me')
          .set(bearer(tokens.sign(customer.subject, options)))
          .expect(401);
      }
    } finally {
      await app.close();
      await new Promise<void>((resolve) => jwks.close(() => resolve()));
    }
  });
});
