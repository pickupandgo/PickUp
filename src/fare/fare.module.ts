import { Module } from '@nestjs/common';
import { FareService } from './fare.service';
import { FareController } from './fare.controller';

@Module({
  controllers: [FareController],
  providers: [FareService],
  exports: [FareService],
})
export class FareModule {}
