import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AdminOnly } from '../auth/decorators';
import {
  AdminActionPageResponse,
  FinancialEventPageResponse,
  ListAdminActionsQuery,
  ListFinancialEventsQuery,
  ListWebhookEventsQuery,
  WebhookEventPageResponse,
} from './audit.dto';
import {
  AuditEventsService,
  toAdminActionResponse,
  toFinancialEventResponse,
} from './audit-events.service';

/**
 * The audit trail (payment flow Phase 7), admin only and read-only:
 *
 *   financial-events  every change to a financial record, with who made it, in which request
 *                     or job run, and what changed
 *   admin-actions     every admin decision (refunds, holds, bank accounts, fee rules, ...)
 *   webhook-events    every signed provider event and what the backend did with it
 */
@ApiTags('admin')
@AdminOnly()
@Controller({ path: 'admin/audit', version: '1' })
export class AdminAuditController {
  constructor(private readonly audit: AuditEventsService) {}

  @Get('financial-events')
  async financialEvents(
    @Query() query: ListFinancialEventsQuery,
  ): Promise<FinancialEventPageResponse> {
    const page = await this.audit.financialEvents(query);
    return { items: page.items.map(toFinancialEventResponse), nextCursor: page.nextCursor };
  }

  @Get('admin-actions')
  async adminActions(@Query() query: ListAdminActionsQuery): Promise<AdminActionPageResponse> {
    const page = await this.audit.adminActions(query);
    return { items: page.items.map(toAdminActionResponse), nextCursor: page.nextCursor };
  }

  @Get('webhook-events')
  webhookEvents(@Query() query: ListWebhookEventsQuery): Promise<WebhookEventPageResponse> {
    return this.audit.webhookEvents(query);
  }
}
