import { type DynamicModule, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { EngineConfigModule } from './config/engine-config.module';
import type { EngineConfig } from './config/engine-config';
import { DriversModule } from './drivers/drivers.module';
import { FareModule } from './fare/fare.module';
import { OutboxModule } from './outbox/outbox.module';
import { PaymentBackendModule } from './payment-backend/payment-backend.module';
import { PrismaModule } from './prisma/prisma.module';
import { RidesModule } from './rides/rides.module';
import { TripsModule } from './trips/trips.module';

@Module({})
export class AppModule {
  /** The validated configuration is passed in, so tests build the same app with their own. */
  static register(config: EngineConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        EngineConfigModule.register(config),
        PrismaModule,
        AuthModule,
        PaymentBackendModule,
        DriversModule,
        OutboxModule,
        RidesModule,
        TripsModule,
        FareModule,
      ],
      controllers: [AppController],
      providers: [AppService],
    };
  }
}
