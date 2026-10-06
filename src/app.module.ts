import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth/auth.guard';
import { AuthModule } from './auth/auth.module';
import { BookingsModule } from './bookings/bookings.module';
import { CollectionsModule } from './collections/collections.module';
import { ClockModule } from './common/clock';
import { AppThrottlerGuard } from './common/http/app-throttler.guard';
import { buildLoggerModule } from './common/logging/logger.module';
import type { AppConfig } from './config/app-config';
import { AppConfigModule } from './config/app-config.module';
import { EarningsModule } from './earnings/earnings.module';
import { EngineModule } from './engine/engine.module';
import { FeesModule } from './fees/fees.module';
import { HealthModule } from './health/health.module';
import { PaymentsModule } from './payments/payments.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { SettlementsModule } from './settlements/settlements.module';
import { SimulationModule } from './simulation/simulation.module';
import { WalletModule } from './wallet/wallet.module';

@Module({})
export class AppModule {
  /** Builds the application from an already-validated config (see loadConfig). */
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.register(config),
        buildLoggerModule(config),
        // Default: 120 requests per minute per user (or per IP when unauthenticated).
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }] }),
        PrismaModule,
        ClockModule,
        AuthModule,
        HealthModule,
        WalletModule,
        FeesModule,
        EarningsModule,
        SettlementsModule,
        BookingsModule,
        CollectionsModule,
        PaymentsModule,
        PayoutsModule,
        EngineModule,
        ReconciliationModule,
        // Non-production only: /v1/dev/simulate, mounted when a simulated provider is configured.
        ...(config.simulation.enabled ? [SimulationModule] : []),
      ],
      providers: [
        // Order matters: authenticate first, then rate limit per resolved user.
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
      ],
    };
  }
}
