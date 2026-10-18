import { Injectable } from '@nestjs/common';
import { paiseToNumber } from '../common/money';
import type {
  AdminAction,
  FinancialEvent,
  PaymentEvent,
  PayoutEvent,
  Prisma,
} from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminActionResponse,
  FinancialEventResponse,
  ListAdminActionsQuery,
  ListFinancialEventsQuery,
  ListWebhookEventsQuery,
  WebhookEventResponse,
} from './audit.dto';

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** The longest booking trail the admin booking chain returns in full. */
export const BOOKING_TRAIL_LIMIT = 500;

/**
 * Read side of the audit trail (payment flow Phase 7): the financial event log, the admin
 * decisions and the provider webhook events. Read-only; nothing here writes.
 */
@Injectable()
export class AuditEventsService {
  constructor(private readonly prisma: PrismaService) {}

  async financialEvents(query: ListFinancialEventsQuery): Promise<Page<FinancialEvent>> {
    const limit = query.limit ?? 50;
    const order = query.order ?? 'desc';
    const where: Prisma.FinancialEventWhereInput = {
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(query.driverId ? { driverId: query.driverId } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorType ? { actorType: query.actorType } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.providerEventId ? { providerEventId: query.providerEventId } : {}),
      ...(query.from || query.to ? { occurredAt: timeRange(query.from, query.to) } : {}),
      ...(query.cursor
        ? { id: order === 'asc' ? { gt: BigInt(query.cursor) } : { lt: BigInt(query.cursor) } }
        : {}),
    };
    const rows = await this.prisma.financialEvent.findMany({
      where,
      orderBy: { id: order },
      take: limit + 1,
    });
    return page(rows, limit, (row) => row.id.toString());
  }

  /** A booking's whole money trail, oldest first; `complete` is false past the limit. */
  async bookingTrail(bookingId: string): Promise<{ events: FinancialEvent[]; complete: boolean }> {
    const rows = await this.prisma.financialEvent.findMany({
      where: { bookingId },
      orderBy: { id: 'asc' },
      take: BOOKING_TRAIL_LIMIT + 1,
    });
    return {
      events: rows.slice(0, BOOKING_TRAIL_LIMIT),
      complete: rows.length <= BOOKING_TRAIL_LIMIT,
    };
  }

  async adminActions(query: ListAdminActionsQuery): Promise<Page<AdminAction>> {
    const limit = query.limit ?? 50;
    const rows = await this.prisma.adminAction.findMany({
      where: {
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.targetType ? { targetType: query.targetType } : {}),
        ...(query.targetId ? { targetId: query.targetId } : {}),
        ...(query.from || query.to ? { createdAt: timeRange(query.from, query.to) } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return page(rows, limit, (row) => row.id);
  }

  async webhookEvents(query: ListWebhookEventsQuery): Promise<Page<WebhookEventResponse>> {
    const limit = query.limit ?? 50;
    const common = {
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
      ...(query.eventId ? { eventId: query.eventId } : {}),
      ...(query.problemsOnly === 'true'
        ? { processedAt: { not: null }, processingError: { not: null } }
        : {}),
      ...(query.from || query.to ? { createdAt: timeRange(query.from, query.to) } : {}),
    };
    const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];
    const cursor: { cursor?: { id: string }; skip?: number } = query.cursor
      ? { cursor: { id: query.cursor }, skip: 1 }
      : {};
    if ((query.source ?? 'RAZORPAY') === 'RAZORPAYX') {
      const rows = await this.prisma.payoutEvent.findMany({
        where: { ...common, ...(query.payoutId ? { payoutId: query.payoutId } : {}) },
        orderBy,
        take: limit + 1,
        ...cursor,
      });
      return mapPage(
        page(rows, limit, (row) => row.id),
        (row) => toWebhookEventResponse('RAZORPAYX', row),
      );
    }
    const rows = await this.prisma.paymentEvent.findMany({
      where: { ...common, ...(query.paymentId ? { paymentId: query.paymentId } : {}) },
      orderBy,
      take: limit + 1,
      ...cursor,
    });
    return mapPage(
      page(rows, limit, (row) => row.id),
      (row) => toWebhookEventResponse('RAZORPAY', row),
    );
  }
}

export function toFinancialEventResponse(event: FinancialEvent): FinancialEventResponse {
  return {
    id: event.id.toString(),
    occurredAt: event.occurredAt.toISOString(),
    transactionId: event.transactionId.toString(),
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    statusFrom: event.statusFrom,
    statusTo: event.statusTo,
    bookingId: event.bookingId,
    driverId: event.driverId,
    amountPaise: event.amountPaise === null ? null : paiseToNumber(event.amountPaise),
    changes: asObject(event.changes),
    actorType: event.actorType,
    actorUserId: event.actorUserId,
    requestId: event.requestId,
    origin: event.origin,
    providerEventId: event.providerEventId,
    dbRole: event.dbRole,
  };
}

export function toAdminActionResponse(action: AdminAction): AdminActionResponse {
  return {
    id: action.id,
    actorUserId: action.actorUserId,
    action: action.action,
    targetType: action.targetType,
    targetId: action.targetId,
    reason: action.reason,
    details: asObject(action.details),
    createdAt: action.createdAt.toISOString(),
  };
}

/**
 * A stored webhook event, without its payload (a payment entity carries the customer's contact
 * details): only the entity it is about and that entity's status are read from it.
 */
export function toWebhookEventResponse(
  source: 'RAZORPAY' | 'RAZORPAYX',
  event: PaymentEvent | PayoutEvent,
): WebhookEventResponse {
  const entity = webhookEntity(event.payload);
  return {
    source,
    id: event.id,
    eventId: event.eventId,
    eventType: event.eventType,
    entityId: entity.id,
    entityStatus: entity.status,
    paymentId: 'paymentId' in event ? event.paymentId : null,
    payoutId: 'payoutId' in event ? event.payoutId : null,
    outcome: event.outcome,
    attempts: event.attempts,
    processingError: event.processingError,
    createdAt: event.createdAt.toISOString(),
    processedAt: event.processedAt?.toISOString() ?? null,
  };
}

/** The first entity of a Razorpay webhook envelope: { payload: { <name>: { entity } } }. */
export function webhookEntity(payload: Prisma.JsonValue): {
  id: string | null;
  status: string | null;
} {
  const entities = asObject(asObject(payload).payload);
  for (const wrapper of Object.values(entities)) {
    const entity = asObject(asObject(wrapper).entity);
    if (typeof entity.id === 'string') {
      return {
        id: entity.id.slice(0, 100),
        status: typeof entity.status === 'string' ? entity.status.slice(0, 40) : null,
      };
    }
  }
  return { id: null, status: null };
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function timeRange(from: string | undefined, to: string | undefined): { gte?: Date; lt?: Date } {
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lt: new Date(to) } : {}),
  };
}

function page<T>(rows: T[], limit: number, cursorOf: (row: T) => string): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last !== undefined ? cursorOf(last) : null };
}

function mapPage<T, U>(source: Page<T>, map: (row: T) => U): Page<U> {
  return { items: source.items.map(map), nextCursor: source.nextCursor };
}
