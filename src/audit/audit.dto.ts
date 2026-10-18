import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ACTOR_TYPES, type ActorType } from './financial-context';

/** The financial records the event log covers (financial_events.entity_type). */
export const FINANCIAL_EVENT_ENTITY_TYPES = [
  'BOOKING',
  'TRIP',
  'BOOKING_STOP',
  'PAYMENT',
  'PAYMENT_COLLECTION',
  'PAYMENT_SETTLEMENT',
  'PAYMENT_DISPUTE',
  'PAYMENT_REFUND',
  'DRIVER_EARNING',
  'PAYOUT_BATCH',
  'DRIVER_PAYOUT',
  'PAYOUT_ITEM',
  'WALLET_TRANSACTION',
  'ADMIN_ACTION',
] as const;
export type FinancialEventEntityType = (typeof FINANCIAL_EVENT_ENTITY_TYPES)[number];

export const FINANCIAL_EVENT_ACTIONS = [
  'CREATED',
  'STATUS_CHANGED',
  'PAYMENT_STATUS_CHANGED',
  'UPDATED',
  'DELETED',
] as const;

export const WEBHOOK_SOURCES = ['RAZORPAY', 'RAZORPAYX'] as const;

const AUDIT_CODE = /^[A-Z][A-Z0-9_]{1,59}$/;

export class ListFinancialEventsQuery {
  @IsOptional()
  @IsUUID('4')
  bookingId?: string;

  @IsOptional()
  @IsUUID('4')
  driverId?: string;

  @IsOptional()
  @IsIn(FINANCIAL_EVENT_ENTITY_TYPES)
  entityType?: FinancialEventEntityType;

  @IsOptional()
  @IsUUID('4')
  entityId?: string;

  @IsOptional()
  @IsIn(FINANCIAL_EVENT_ACTIONS)
  action?: (typeof FINANCIAL_EVENT_ACTIONS)[number];

  @IsOptional()
  @IsIn(ACTOR_TYPES)
  actorType?: ActorType;

  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  /** Everything one request (X-Request-Id) or one reconciliation run changed. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  requestId?: string;

  /** Everything one provider webhook event changed. */
  @IsOptional()
  @IsString()
  @Length(1, 150)
  providerEventId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  /** asc: oldest first (a record's history); desc (default): newest first. */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  /** Page size, 1-200. Defaults to 50. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  /** `nextCursor` from the previous page. */
  @IsOptional()
  @IsString()
  @Matches(/^[1-9][0-9]{0,18}$/, { message: 'cursor is invalid' })
  cursor?: string;
}

export class FinancialEventResponse {
  /** Position in the log: strictly increasing. */
  id!: string;
  occurredAt!: string;
  /** Events with the same transaction id were committed together. */
  transactionId!: string;
  entityType!: string;
  entityId!: string;
  /** CREATED, STATUS_CHANGED, PAYMENT_STATUS_CHANGED, UPDATED or DELETED. */
  action!: string;
  statusFrom!: string | null;
  statusTo!: string | null;
  bookingId!: string | null;
  driverId!: string | null;
  amountPaise!: number | null;
  /** CREATED / DELETED: the row. Otherwise the columns that changed: { column: { from, to } }. */
  changes!: Record<string, unknown>;
  /** ADMIN, DRIVER, CUSTOMER, ENGINE, PROVIDER, SYSTEM or UNATTRIBUTED. */
  actorType!: string;
  actorUserId!: string | null;
  requestId!: string | null;
  origin!: string | null;
  providerEventId!: string | null;
  /** The database role that made the change. */
  dbRole!: string;
}

export class FinancialEventPageResponse {
  items!: FinancialEventResponse[];
  nextCursor!: string | null;
}

export class ListAdminActionsQuery {
  @IsOptional()
  @IsUUID('4')
  actorUserId?: string;

  @IsOptional()
  @IsString()
  @Matches(AUDIT_CODE, { message: 'action is invalid' })
  action?: string;

  @IsOptional()
  @IsString()
  @Matches(AUDIT_CODE, { message: 'targetType is invalid' })
  targetType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  targetId?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}

export class AdminActionResponse {
  id!: string;
  actorUserId!: string | null;
  action!: string;
  targetType!: string;
  targetId!: string;
  reason!: string | null;
  details!: Record<string, unknown>;
  createdAt!: string;
}

export class AdminActionPageResponse {
  items!: AdminActionResponse[];
  nextCursor!: string | null;
}

export class ListWebhookEventsQuery {
  /** RAZORPAY (payments, collections, refunds, disputes, settlements) or RAZORPAYX (payouts). */
  @IsOptional()
  @IsIn(WEBHOOK_SOURCES)
  source?: (typeof WEBHOOK_SOURCES)[number];

  @IsOptional()
  @IsString()
  @Matches(/^[a-z_.]{3,100}$/, { message: 'eventType is invalid' })
  eventType?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_]{2,40}$/, { message: 'outcome is invalid' })
  outcome?: string;

  @IsOptional()
  @IsString()
  @Length(1, 150)
  eventId?: string;

  /** RAZORPAY only: events applied to this payment. */
  @IsOptional()
  @IsUUID('4')
  paymentId?: string;

  /** RAZORPAYX only: events applied to this payout. */
  @IsOptional()
  @IsUUID('4')
  payoutId?: string;

  /** true: only events processed with a problem (the anomalies). */
  @IsOptional()
  @IsIn(['true', 'false'])
  problemsOnly?: 'true' | 'false';

  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}

export class WebhookEventResponse {
  source!: (typeof WEBHOOK_SOURCES)[number];
  id!: string;
  eventId!: string;
  eventType!: string;
  /** The provider entity the event is about (pay_, qr_, plink_, rfnd_, disp_, setl_, pout_). */
  entityId!: string | null;
  entityStatus!: string | null;
  paymentId!: string | null;
  payoutId!: string | null;
  outcome!: string | null;
  attempts!: number;
  processingError!: string | null;
  createdAt!: string;
  processedAt!: string | null;
}

export class WebhookEventPageResponse {
  items!: WebhookEventResponse[];
  nextCursor!: string | null;
}
