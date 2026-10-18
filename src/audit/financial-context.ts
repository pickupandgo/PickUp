import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '../generated/prisma/client';

/**
 * Who is acting, for the financial event log (payment flow Phase 7).
 *
 * The database triggers on every financial table write one financial_events row per change, in
 * the same transaction. They learn the actor and request from transaction-local settings
 * (set_config(..., true)) that the service layer sets first in each transaction from this
 * context. The context follows the request (or job run) through every async call, so no service
 * signature changes:
 *
 *   ADMIN / DRIVER / CUSTOMER  an authenticated API request (the user and their role)
 *   ENGINE                     the trip engine's server-to-server API
 *   PROVIDER                   a signed Razorpay or RazorpayX webhook (with its event id)
 *   SYSTEM                     a scheduled job (payout schedule, settlement sync, reconciliation)
 *   UNATTRIBUTED               nothing set: an operator's SQL, a fixture, a path not yet tagged
 *
 * It only describes who acted; it never changes what a transaction does.
 */
export const ACTOR_TYPES = [
  'ADMIN',
  'DRIVER',
  'CUSTOMER',
  'ENGINE',
  'PROVIDER',
  'SYSTEM',
  'UNATTRIBUTED',
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export interface FinancialContextValues {
  readonly actorType: ActorType;
  readonly actorUserId: string | null;
  /** HTTP request id (X-Request-Id), or the job run id. */
  readonly requestId: string | null;
  /** "POST /v1/admin/refunds", "webhook razorpay payment.captured", "job COLLECTION_RECOVERY". */
  readonly origin: string | null;
  /** The provider webhook event being processed. */
  readonly providerEventId: string | null;
}

type MutableValues = { -readonly [K in keyof FinancialContextValues]: FinancialContextValues[K] };

const NONE: FinancialContextValues = {
  actorType: 'UNATTRIBUTED',
  actorUserId: null,
  requestId: null,
  origin: null,
  providerEventId: null,
};

const storage = new AsyncLocalStorage<MutableValues>();

export const FinancialContext = {
  /** Runs `work` (and everything it awaits) as the given actor. */
  run<T>(values: Partial<FinancialContextValues>, work: () => T): T {
    return storage.run({ ...NONE, ...values }, work);
  },

  /**
   * Keeps the caller's context when there is one (an admin who triggered a job by hand), and
   * otherwise runs `work` as the given actor (the same job started by its timer).
   */
  runIfAbsent<T>(values: Partial<FinancialContextValues>, work: () => T): T {
    return storage.getStore() ? work() : FinancialContext.run(values, work);
  },

  current(): FinancialContextValues | undefined {
    return storage.getStore();
  },

  /** Adds what is learned later in a request (a webhook's provider and event id). */
  annotate(patch: Partial<FinancialContextValues>): void {
    const store = storage.getStore();
    if (store) {
      Object.assign(store, patch);
    }
  },
};

export interface FinancialContextSettings {
  readonly actorType: ActorType;
  readonly actorUserId: string;
  readonly requestId: string;
  readonly origin: string;
  readonly providerEventId: string;
}

/**
 * The values the triggers read, '' for unknown. Lengths are capped to the columns; the triggers
 * validate again and never let a context value fail a financial write.
 */
export function financialContextSettings(
  values: FinancialContextValues = FinancialContext.current() ?? NONE,
): FinancialContextSettings {
  return {
    actorType: ACTOR_TYPES.includes(values.actorType) ? values.actorType : 'UNATTRIBUTED',
    actorUserId: values.actorUserId ?? '',
    requestId: clip(values.requestId, 100),
    origin: clip(values.origin, 150),
    providerEventId: clip(values.providerEventId, 150),
  };
}

type RawExecutor = Pick<Prisma.TransactionClient, '$executeRaw'>;

/**
 * Sets the current financial context for the rest of the transaction (set_config(..., true),
 * reset when it ends). Run it first in each transaction. `lockTimeout` also sets lock_timeout
 * the same way, in the same statement (one round trip, as before Phase 7).
 */
export function financialContextStatement(
  db: RawExecutor,
  options: { readonly lockTimeout?: string } = {},
): Prisma.PrismaPromise<number> {
  const settings = financialContextSettings();
  if (options.lockTimeout) {
    return db.$executeRaw`
      SELECT set_config('lock_timeout', ${options.lockTimeout}, true),
             set_config('app.actor_type', ${settings.actorType}, true),
             set_config('app.actor_user_id', ${settings.actorUserId}, true),
             set_config('app.request_id', ${settings.requestId}, true),
             set_config('app.origin', ${settings.origin}, true),
             set_config('app.provider_event_id', ${settings.providerEventId}, true)`;
  }
  return db.$executeRaw`
    SELECT set_config('app.actor_type', ${settings.actorType}, true),
           set_config('app.actor_user_id', ${settings.actorUserId}, true),
           set_config('app.request_id', ${settings.requestId}, true),
           set_config('app.origin', ${settings.origin}, true),
           set_config('app.provider_event_id', ${settings.providerEventId}, true)`;
}

function clip(value: string | null, max: number): string {
  return value === null ? '' : value.slice(0, max);
}
