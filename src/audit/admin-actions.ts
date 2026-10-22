import type { Prisma } from '../generated/prisma/client';

type AuditDetails = Readonly<Record<string, string | number | boolean | null>>;

export interface AdminActionInput {
  /** The admin who acted; null for the ops CLI and the payout scheduler. */
  readonly actorUserId: string | null;
  /** UPPER_SNAKE_CASE verb, e.g. FEE_RULE_CREATED, EARNING_HELD. */
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly reason?: string | null;
  readonly details?: AuditDetails;
}

/** Anything that can write admin_actions: the Prisma client or an open transaction. */
export type AuditWriter = Pick<Prisma.TransactionClient, 'adminAction'>;

/**
 * Appends to the admin_actions audit trail (M1). Call it inside the same transaction as the
 * change it describes, so the audit row and the change commit or roll back together.
 */
export async function recordAdminAction(db: AuditWriter, input: AdminActionInput): Promise<void> {
  await db.adminAction.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason ?? null,
      details: input.details ?? {},
    },
  });
}
