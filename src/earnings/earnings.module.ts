import { Module } from '@nestjs/common';
import { AdminEarningsController } from './admin-earnings.controller';
import { EarningsController } from './earnings.controller';
import { EarningsService } from './earnings.service';

@Module({
  controllers: [EarningsController, AdminEarningsController],
  providers: [EarningsService],
  exports: [EarningsService],
})
export class EarningsModule {}
