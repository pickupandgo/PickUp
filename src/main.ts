import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap/configure-app';
import { ConfigurationError, loadConfig, openReadinessItems } from './config/app-config';

async function bootstrap(): Promise<void> {
  // Local development convenience only. In production, configuration comes from the platform's
  // environment / secret manager, never from a file baked into the image.
  if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    rawBody: true,
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);

  configureApp(app, config);
  await app.listen(config.port, '0.0.0.0');

  logger.log(
    { port: config.port, nodeEnv: config.nodeEnv, razorpayMode: config.razorpay.mode },
    'MultipleRide backend started',
  );
  if (config.nodeEnv === 'production' && config.swaggerEnabled) {
    logger.warn('SWAGGER_ENABLED is true in production; API docs are publicly reachable');
  }
  if (config.nodeEnv === 'production' && config.razorpay.mode === 'test') {
    logger.warn('Running in production with Razorpay TEST keys; no real money will move');
  }
  const openItems = openReadinessItems(config);
  if (openItems.length > 0) {
    const report = { openItems };
    const message = 'Open production-readiness items (docs/OPEN_DECISIONS.md)';
    if (config.nodeEnv === 'production') {
      logger.warn(report, message);
    } else {
      logger.log(report, message);
    }
  }
}

bootstrap().catch((error: unknown) => {
  // Configuration problems list variable names only, never values.
  const message = error instanceof ConfigurationError ? error.message : error;
  console.error('Failed to start MultipleRide backend:', message);
  process.exit(1);
});
