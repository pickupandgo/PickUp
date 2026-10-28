import { envSchema, isRefundCase, parseCsv, parseRefundCases, type RefundCase } from './env.schema';

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
  readonly documents: {
    readonly storage: null | {
      readonly endpoint: string | undefined;
      readonly region: string;
      readonly bucket: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
      readonly forcePathStyle: boolean;
    };
    readonly uploadTtlSeconds: number;
    readonly downloadTtlSeconds: number;
    readonly maxBytes: number;
    readonly allowedContentTypes: readonly string[];
    readonly scanner:
      | null
      | { readonly kind: 'http'; readonly url: string; readonly token: string }
      | {
          readonly kind: 'guardduty';
          readonly eventToken: string;
          readonly awsAccountId: string;
          readonly region: string;
        };
  };
  readonly manualKyc: {
    readonly enabled: boolean;
    readonly policyVersion: string | null;
    readonly requiredDocuments: readonly string[];
    readonly checklist: readonly string[];
  };
  readonly onboarding: { readonly requiredVehicleDocuments: readonly string[] };
  readonly collections: {
    /** Product used for new ONLINE_QR collections, or null when online collection is off. */
    readonly product: CollectionProductSetting | null;
    /**
     * True when QR codes are simulated in memory and paid through /v1/dev/simulate (local
     * end-to-end runs; config validation refuses it in production and with live keys).
     */
    readonly simulated: boolean;
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
  readonly earnings: {
    /**
     * EARNINGS_UNDELIVERED_DROP_HOLD (OPEN_DECISIONS L-11 / D-70, open business decision): hold
     * the online part of an earning whose booking has a drop resolved UNDELIVERED for an admin's
     * review. Technical safe default: true. Never moves money on its own.
     */
    readonly undeliveredDropHold: boolean;
  };
  /**
   * Refunds (payment flow Phase 6). The refund policy is open (OPEN_DECISIONS L-7 to L-10,
   * L-21); these are its technical safe defaults. Every refund is admin-initiated, with a reason,
   * and audited; nothing is refunded, debited or recovered automatically.
   */
  readonly refunds: {
    /** Where provider refunds go, or null when they are off (cash returns can still be recorded). */
    readonly provider: 'razorpay' | 'simulated' | null;
    /** REFUND_PARTIAL_ALLOWED (L-9). Default false: a refund returns all that is left of its source. */
    readonly partialAllowed: boolean;
    /** Always false: automatic refunds on cancellation are not implemented (L-8). */
    readonly autoOnCancel: false;
    /** REFUND_ALLOWED_CASES (L-7). Default: every case, each still admin-initiated. */
    readonly allowedCases: readonly RefundCase[];
  };
  readonly fare: {
    /** Seconds a fare quote stays bookable. */
    readonly quoteTtlSeconds: number;
    /** Most drops a quote (and so a booking) may have. Technical default 5 (open: D-29). */
    readonly maxDrops: number;
  };
  /**
   * Production-readiness confirmations (go-live checklist). Without them the matching live
   * provider is refused in production and with live keys.
   */
  readonly readiness: {
    /** RAZORPAYX_CAPABILITIES_CONFIRMED (D-46, D-58). */
    readonly razorpayxCapabilitiesConfirmed: boolean;
    /** SETTLEMENT_RECON_VERIFIED (D-56). */
    readonly settlementReconVerified: boolean;
    /** REFUNDS_PROVIDER_VERIFIED (D-72). */
    readonly refundsProviderVerified: boolean;
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

/**
 * Production-readiness items still open for this deployment, for the startup log. Each one keeps
 * a money path off rather than assuming an unconfirmed provider capability.
 */
export function openReadinessItems(config: AppConfig): string[] {
  const items: string[] = [];
  if (config.payouts.provider !== 'razorpayx' || !config.readiness.razorpayxCapabilitiesConfirmed) {
    items.push(
      'D-46/D-58: RazorpayX activation and capabilities (Payouts, Fund Account Validation, webhooks) not confirmed; real payouts and bank validation are off',
    );
  }
  if (config.settlements.provider !== 'razorpay' || !config.readiness.settlementReconVerified) {
    items.push(
      'D-56: settlement reconciliation not verified on the live account; ONLINE earnings are not made payable from live settlement data',
    );
  }
  items.push('D-57: TDS policy DISABLED until the CA confirms the rule');
  // Open business decisions with a technical safe default (payment flow Phase 5).
  items.push(
    config.earnings.undeliveredDropHold
      ? 'L-11/D-70 (open business decision): a trip with an undelivered drop pays out only what was collected, and its online part is held for admin review (technical safe default)'
      : 'L-11/D-70 (open business decision): the undelivered-drop review hold is OFF (EARNINGS_UNDELIVERED_DROP_HOLD=false); such a trip pays out what was collected once settled, without review',
  );
  items.push(
    'N5 driver pay (open business decision): a partly paid trip pays out only what was collected and settled; nothing is refunded, compensated or recovered automatically',
  );
  // Refunds (payment flow Phase 6): the provider gate, then the open refund policy.
  if (config.refunds.provider !== 'razorpay' || !config.readiness.refundsProviderVerified) {
    items.push(
      config.refunds.provider === 'simulated'
        ? 'D-72: provider refunds are simulated (local end-to-end runs only); Razorpay refunds are not verified on the live account'
        : config.refunds.provider === 'razorpay'
          ? 'D-72: Razorpay refunds are not verified on the live account (test mode only)'
          : 'D-72: Razorpay refunds not verified on the live account; provider refunds are off (cash returns can still be recorded)',
    );
  }
  const cases = config.refunds.allowedCases;
  items.push(
    `L-7 to L-10, L-21 (open business decisions): refunds are admin-initiated only, with a reason and an audit record; nothing is refunded, debited or recovered automatically; ${
      config.refunds.partialAllowed
        ? 'partial refunds allowed (REFUND_PARTIAL_ALLOWED=true)'
        : 'a refund returns all that is left of its source'
    }; cases: ${cases.length > 0 ? cases.join(', ') : 'NONE'}`,
  );
  if (config.collections.simulated) {
    items.push(
      'D-47: collection QR codes are simulated (local end-to-end runs only); live needs Razorpay QR Codes (UPI QR)',
    );
  } else if (config.collections.product !== 'QR_CODE') {
    items.push(
      config.collections.product === null
        ? 'D-47: Razorpay QR Codes (UPI QR) not enabled; drivers collect cash only'
        : 'D-47: collecting with a payment-link QR (test mode only); live needs Razorpay QR Codes (UPI QR)',
    );
  }
  return items;
}

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
    documents: {
      storage:
        env.DOCUMENT_STORAGE_PROVIDER === 's3'
          ? {
              endpoint: env.DOCUMENT_STORAGE_ENDPOINT,
              region: env.DOCUMENT_STORAGE_REGION!,
              bucket: env.DOCUMENT_STORAGE_BUCKET!,
              accessKeyId: env.DOCUMENT_STORAGE_ACCESS_KEY_ID!,
              secretAccessKey: env.DOCUMENT_STORAGE_SECRET_ACCESS_KEY!,
              forcePathStyle: env.DOCUMENT_STORAGE_FORCE_PATH_STYLE,
            }
          : null,
      uploadTtlSeconds: env.DOCUMENT_UPLOAD_TTL_SECONDS,
      downloadTtlSeconds: env.DOCUMENT_DOWNLOAD_TTL_SECONDS,
      maxBytes: env.DOCUMENT_MAX_BYTES,
      allowedContentTypes: parseCsv(env.DOCUMENT_ALLOWED_CONTENT_TYPES),
      scanner:
        env.DOCUMENT_SCANNER_PROVIDER === 'http'
          ? { kind: 'http' as const, url: env.DOCUMENT_SCANNER_URL!, token: env.DOCUMENT_SCANNER_TOKEN! }
          : env.DOCUMENT_SCANNER_PROVIDER === 'guardduty'
            ? {
                kind: 'guardduty' as const,
                eventToken: env.GUARDDUTY_EVENT_TOKEN!,
                awsAccountId: env.GUARDDUTY_AWS_ACCOUNT_ID!,
                region: env.GUARDDUTY_REGION!,
              }
            : null,
    },
    manualKyc: {
      enabled: env.MANUAL_KYC_ENABLED,
      policyVersion: env.MANUAL_KYC_POLICY_VERSION ?? null,
      requiredDocuments: parseCsv(env.MANUAL_KYC_REQUIRED_DOCUMENTS).map((v) => v.toUpperCase()),
      checklist: parseCsv(env.MANUAL_KYC_CHECKLIST).map((v) => v.toUpperCase()),
    },
    onboarding: {
      requiredVehicleDocuments: parseCsv(env.VEHICLE_REQUIRED_DOCUMENTS).map((v) =>
        v.toUpperCase(),
      ),
    },
    collections: {
      product: COLLECTION_PRODUCTS[env.COLLECTION_LINK_PROVIDER],
      simulated: env.COLLECTION_LINK_PROVIDER === 'simulated',
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
    earnings: {
      undeliveredDropHold: env.EARNINGS_UNDELIVERED_DROP_HOLD,
    },
    refunds: {
      provider: env.REFUND_PROVIDER === 'disabled' ? null : env.REFUND_PROVIDER,
      partialAllowed: env.REFUND_PARTIAL_ALLOWED,
      // The schema refuses REFUND_AUTO_ON_CANCEL=true (L-8 is open).
      autoOnCancel: false,
      allowedCases: parseRefundCases(env.REFUND_ALLOWED_CASES).filter(isRefundCase),
    },
    fare: {
      quoteTtlSeconds: env.FARE_QUOTE_TTL_SECONDS,
      maxDrops: env.FARE_MAX_DROPS,
    },
    readiness: {
      razorpayxCapabilitiesConfirmed: env.RAZORPAYX_CAPABILITIES_CONFIRMED,
      settlementReconVerified: env.SETTLEMENT_RECON_VERIFIED,
      refundsProviderVerified: env.REFUNDS_PROVIDER_VERIFIED,
    },
    simulation: {
      enabled:
        env.SETTLEMENT_PROVIDER === 'simulated' ||
        env.PAYOUT_PROVIDER === 'simulated' ||
        env.COLLECTION_LINK_PROVIDER === 'simulated' ||
        env.REFUND_PROVIDER === 'simulated',
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
  'disabled' | 'razorpay_payment_link' | 'razorpay_qr_code' | 'simulated',
  CollectionProductSetting | null
> = {
  disabled: null,
  razorpay_payment_link: 'PAYMENT_LINK',
  razorpay_qr_code: 'QR_CODE',
  // Simulated Razorpay QR codes: the same rows and webhooks as QR_CODE.
  simulated: 'QR_CODE',
};

function deepFreeze<T extends object>(value: T): T {
  for (const nested of Object.values(value)) {
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested as object);
    }
  }
  return Object.freeze(value);
}
