import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { AppConfig } from '../config/app-config';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter';
import { noStoreMiddleware } from '../common/http/no-store';
import { requestIdMiddleware } from '../common/http/request-id';
import { createValidationPipe } from '../common/http/validation';

/** Largest accepted JSON body. Razorpay webhooks and every API request are far smaller. */
export const MAX_JSON_BODY = '100kb';

/**
 * HTTP hardening and global pipeline shared by main.ts and the test harness, so tests exercise
 * exactly what production runs. Call before `app.init()`.
 */
export function configureApp(app: NestExpressApplication, config: AppConfig): void {
  // First middleware, so every response (even body-parser errors) carries a request id.
  app.use(requestIdMiddleware);
  // Balances and payment states must never be stored by a phone, proxy or CDN. ETags are off
  // too, so the API never answers 304 Not Modified from a client's old copy.
  app.use(noStoreMiddleware);
  app.set('etag', false);

  // Correct client IPs (rate limiting, logs) when running behind a load balancer.
  app.set('trust proxy', config.trustProxyHops);
  app.disable('x-powered-by');
  // Replaces Nest's default JSON parser; the raw body is still kept for webhook signatures.
  app.useBodyParser('json', { limit: MAX_JSON_BODY });

  // Swagger UI needs inline scripts, so CSP is relaxed only when the docs are enabled.
  app.use(helmet({ contentSecurityPolicy: config.swaggerEnabled ? false : undefined }));

  // Mobile apps do not use CORS. Only explicitly listed browser origins (admin panel) are allowed.
  if (config.corsOrigins.length > 0) {
    app.enableCors({
      origin: [...config.corsOrigins],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id'],
      credentials: false,
      maxAge: 600,
    });
  }

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  if (config.swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('MultipleRide Payments, Earnings & Payouts API')
        .setDescription(
          'Booking payments, pickup/delivery collections, the driver wallet ledger, driver earnings and weekly payouts. Amounts are integer paise (100 paise = Rs 1).',
        )
        .setVersion('1.0')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'Firebase ID token' })
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
  }
}
