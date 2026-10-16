import { Module } from '@nestjs/common';
import { CollectionsModule } from '../collections/collections.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RefundsModule } from '../refunds/refunds.module';
import { SettlementsModule } from '../settlements/settlements.module';
import { DevSimulationController } from './dev-simulation.controller';

/**
 * NON-PRODUCTION ONLY: AppModule imports this only when a simulated provider is configured,
 * which config validation refuses in production and with live Razorpay keys.
 */
@Module({
  imports: [PayoutsModule, SettlementsModule, CollectionsModule, RefundsModule],
  controllers: [DevSimulationController],
})
export class SimulationModule {}
