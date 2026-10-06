import { envSchema, parseCsv } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly trustProxyHops: number;
  readonly corsOrigins: readonly string[];
  readonly swaggerEnabled: boolean;
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
  };
  readonly auth: {
    readonly provider: string;
    readonly jwksUrl: string;
    readonly issuer: string;
    readonly audience: string;
  };
  readonly razorpay: {
    readonly keyId: string;
    readonly keySecret: string;
    /** Current secret first, then the previous one (accepted during a rotation). */
    readonly webhookSecrets: readonly string[];
    readonly apiBaseUrl: string;
    readonly timeoutMs: number;
    readonly mode: 'test' | 'live';
  };
  readonly wallet: {
    readonly topUpMinPaise: bigint;
    readonly topUpMaxPaise: bigint;
    readonly adminAdjustmentMaxPaise: bigint;
  };
  readonly internalApi: {
    /** Accepted X-Internal-Api-Key values. Empty means the internal API is disabled. */
    readonly keys: readonly string[];
  };
  readonly collections: {
    /** Product used for new ONLINE_QR collections, or null when online collection is off. */
    readonly product: CollectionProductSetting | null;
    readonly linkTtlMinutes: number;
  };
  readonly settlements: {
    /** Where merchant settlements come from, or null when nothing is ever settled. */
    readonly provider: 'razorpay' | 'simulated' | null;
    /** Minutes between periodic pulls; 0 = webhook, admin and pre-batch pulls only. */
    readonly syncIntervalMinutes: number;
    readonly lookbackDays: number;
    readonly overdueDays: number;
  };
  readonly tax: {
    /** Always false: TDS waits for a CA-approved rule (OPEN_DECISIONS D-57). */
    readonly tdsEnabled: false;
  };
  /** True when any simulated provider is active (non-production, test keys only). */
  readonly simulation: {
    readonly enabled: boolean;
  };
  readonly payouts: {
    readonly provider: 'razorpayx' | 'simulated' | null;
    readonly razorpayx: {
      readonly accountNumber: string;
      readonly keyId: string;
      readonly keySecret: string;
    } | null;
    /**
     * RazorpayX webhook secrets, current first then the previous one. Empty means the payout
     * webhook endpoint is disabled. The simulated provider (non-production) uses them too.
     */
    readonly webhookSecrets: readonly string[];
    readonly mode: 'IMPS' | 'NEFT' | 'RTGS';
    readonly narration: string;
    readonly queueIfLowBalance: boolean;
    readonly schedule: {
      readonly enabled: boolean;
      /** ISO weekday, 1 = Monday ... 7 = Sunday. Approved default: Monday. */
      readonly weekday: number;
      /** Local time HH:MM in `timeZone`. Approved default: 11:00. */
      readonly time: string;
      readonly timeZone: string;
      readonly autoExecute: boolean;
    };
  };
}

export type CollectionProductSetting = 'PAYMENT_LINK' | 'QR_CODE';

/** Raised when environment configuration is missing or invalid. Never includes values. */
export class ConfigurationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigurationError';
  }
}

/**
 * Parses and validates environment variables into a typed, frozen config object.
 * Empty strings are treated as "not set" so blank lines in .env fail loudly.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value.trim() !== '') {
      cleaned[key] = value.trim();
    }
  }

  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    // Report variable names and rule messages only, never the values themselves.
    const problems = result.error.issues.map((issue) => {
      const name = issue.path.join('.') || 'environment';
      return `${name}: ${issue.message}`;
    });
    throw new ConfigurationError(problems);
  }

  const env = result.data;
  const webhookSecrets = [env.RAZORPAY_WEBHOOK_SECRET];
  if (env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS) {
    webhookSecrets.push(env.RAZORPAY_WEBHOOK_SECRET_PREVIOUS);
  }

  const config: AppConfig = {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    corsOrigins: parseCsv(env.CORS_ORIGINS),
    swaggerEnabled: env.SWAGGER_ENABLED,
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
    },
    auth: {
      provider: env.AUTH_PROVIDER,
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
    },
    razorpay: {
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecrets,
      apiBaseUrl: env.RAZORPAY_API_BASE_URL,
      timeoutMs: env.RAZORPAY_TIMEOUT_MS,
      mode: env.RAZORPAY_KEY_ID.startsWith('rzp_live_') ? 'live' : 'test',
    },
    wallet: {
      topUpMinPaise: BigInt(env.WALLET_TOPUP_MIN_PAISE),
      topUpMaxPaise: BigInt(env.WALLET_TOPUP_MAX_PAISE),
      adminAdjustmentMaxPaise: BigInt(env.ADMIN_ADJUSTMENT_MAX_PAISE),
    },
    internalApi: {
      keys: parseCsv(env.INTERNAL_API_KEYS),
    },
    collections: {
      product: COLLECTION_PRODUCTS[env.COLLECTION_LINK_PROVIDER],
      linkTtlMinutes: env.COLLECTION_LINK_TTL_MINUTES,
    },
    settlements: {
      provider: env.SETTLEMENT_PROVIDER === 'disabled' ? null : env.SETTLEMENT_PROVIDER,
      syncIntervalMinutes: env.SETTLEMENT_SYNC_INTERVAL_MINUTES,
      lookbackDays: env.SETTLEMENT_SYNC_LOOKBACK_DAYS,
      overdueDays: env.SETTLEMENT_OVERDUE_DAYS,
    },
    tax: {
      // The schema refuses TDS_ENABLED=true; this is a constant until a rule is implemented.
      tdsEnabled: false,
    },
    simulation: {
      enabled: env.SETTLEMENT_PROVIDER === 'simulated' || env.PAYOUT_PROVIDER === 'simulated',
    },
    payouts: {
      provider: env.PAYOUT_PROVIDER === 'disabled' ? null : env.PAYOUT_PROVIDER,
      razorpayx:
        env.PAYOUT_PROVIDER === 'razorpayx' &&
        env.RAZORPAYX_ACCOUNT_NUMBER &&
        env.RAZORPAYX_WEBHOOK_SECRET
          ? {
              accountNumber: env.RAZORPAYX_ACCOUNT_NUMBER,
              keyId: env.RAZORPAYX_KEY_ID ?? env.RAZORPAY_KEY_ID,
              keySecret: env.RAZORPAYX_KEY_SECRET ?? env.RAZORPAY_KEY_SECRET,
            }
          : null,
      webhookSecrets:
        env.PAYOUT_PROVIDER !== 'disabled' && env.RAZORPAYX_WEBHOOK_SECRET
          ? [env.RAZORPAYX_WEBHOOK_SECRET, env.RAZORPAYX_WEBHOOK_SECRET_PREVIOUS].filter(
              (secret): secret is string => secret !== undefined,
            )
          : [],
      mode: env.PAYOUT_MODE,
      narration: env.PAYOUT_NARRATION,
      queueIfLowBalance: env.PAYOUT_QUEUE_IF_LOW_BALANCE,
      schedule: {
        enabled: env.PAYOUT_SCHEDULE_ENABLED,
        weekday: env.PAYOUT_SCHEDULE_WEEKDAY,
        time: env.PAYOUT_SCHEDULE_TIME,
        timeZone: env.PAYOUT_SCHEDULE_TIMEZONE,
        autoExecute: env.PAYOUT_AUTO_EXECUTE,
      },
    },
  };

  return deepFreeze(config);
}

const COLLECTION_PRODUCTS: Record<
  'disabled' | 'razorpay_payment_link' | 'razorpay_qr_code',
  CollectionProductSetting | null
> = {
  disabled: null,
  razorpay_payment_link: 'PAYMENT_LINK',
  razorpay_qr_code: 'QR_CODE',
};

function deepFreeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested as object);
    }
  }
  return Object.freeze(value);
}
