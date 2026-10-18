import { Module } from '@nestjs/common';
import { AdminAuditController } from './admin-audit.controller';
import { AuditEventsService } from './audit-events.service';

/** The audit trail's read side (payment flow Phase 7). The log itself is written by triggers. */
@Module({
  controllers: [AdminAuditController],
  providers: [AuditEventsService],
  exports: [AuditEventsService],
})
export class AuditModule {}
