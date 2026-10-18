import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers/drivers.module';
import { OutboxEffects } from './outbox-effects';
import { OutboxService } from './outbox.service';

@Module({
  imports: [DriversModule],
  providers: [OutboxService, OutboxEffects],
  exports: [OutboxService],
})
export class OutboxModule {}
