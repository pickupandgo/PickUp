import { existsSync } from 'node:fs';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigurationError, loadConfig } from './config/engine-config';

async function bootstrap() {
  // Local development convenience only. In production, configuration comes from the platform's
  // environment / secret manager, never from a file.
  if (process.env.NODE_ENV !== 'production' && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.register(config), {
    // One JSON line per log entry in production, so alerts ("alert": "...") can be matched.
    logger: new ConsoleLogger({ json: config.nodeEnv === 'production' }),
  });
  app.enableCors(); // Enable CORS for prototype
  // Stops the outbox sender and closes the database pool on SIGTERM (deploys, restarts).
  app.enableShutdownHooks();
  await app.listen(config.port);
}

bootstrap().catch((error: unknown) => {
  // Configuration problems list variable names only, never values.
  const message = error instanceof ConfigurationError ? error.message : error;
  console.error('Failed to start the trip engine:', message);
  process.exit(1);
});
