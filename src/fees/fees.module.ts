import { Module } from '@nestjs/common';
import { AdminFeeRulesController } from './admin-fee-rules.controller';
import { FeeRulesService } from './fee-rules.service';

@Module({
  controllers: [AdminFeeRulesController],
  providers: [FeeRulesService],
  exports: [FeeRulesService],
})
export class FeesModule {}
