import { z } from 'zod';

/** Firebase's public signing keys (both apps share one Firebase project). */
export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Same format the payment backend accepts in INTERNAL_API_KEYS. */
const INTERNAL_API_KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
const httpUrl = z.url({ protocol: /^https?$/ });

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

    // The engine's own PostgreSQL database (never the payment backend's).
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(
        (value) => /^postgres(ql)?:\/\//.test(value),
        'must be a postgresql:// URL',
      ),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    // Firebase ID tokens of the Customer and Driver apps (same project as the payment backend).
    AUTH_JWKS_URL: httpUrl.default(FIREBASE_JWKS_URL),
    AUTH_ISSUER: z.string().min(1),
    AUTH_AUDIENCE: z.string().min(1),

    // The payment backend (raj_backend) internal API.
    PAYMENT_BACKEND_URL: httpUrl,
    PAYMENT_BACKEND_INTERNAL_API_KEY: z
      .string()
      .regex(
        INTERNAL_API_KEY_PATTERN,
        'must be 32-128 characters of A-Z, a-z, 0-9, _ or -',
      ),
    PAYMENT_BACKEND_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(500)
      .max(30_000)
      .default(5_000),
    // Plain HTTP to the payment backend carries the internal key in clear: production only
    // allows it on a private network, when explicitly set.
    PAYMENT_BACKEND_ALLOW_HTTP: booleanString.default(false),

    // Outbox (engine -> payment backend). 0 = no background sender (tests drive it themselves).
    OUTBOX_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(60_000)
      .default(1_000),
    OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).max(600).default(30),
    OUTBOX_BASE_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(10)
      .max(60_000)
      .default(1_000),
    OUTBOX_MAX_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(3_600_000)
      .default(300_000),
    OUTBOX_ALERT_AFTER_ATTEMPTS: z.coerce
      .number()
      .int()
      .min(1)
      .max(1_000)
      .default(8),

    // How long a driver has to answer an offer (technical default; dispatch rules are D-30).
    DISPATCH_POLL_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(60000)
      .default(1000),
    OFFER_TTL_SECONDS: z.coerce.number().int().min(5).max(600).default(15),
  })
  .superRefine((env, context) => {
    if (env.OUTBOX_MAX_BACKOFF_MS < env.OUTBOX_BASE_BACKOFF_MS) {
      context.addIssue({
        code: 'custom',
        path: ['OUTBOX_MAX_BACKOFF_MS'],
        message: 'must be at least OUTBOX_BASE_BACKOFF_MS',
      });
    }
    if (env.OUTBOX_LEASE_SECONDS * 1000 <= env.PAYMENT_BACKEND_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['OUTBOX_LEASE_SECONDS'],
        message: 'must be longer than PAYMENT_BACKEND_TIMEOUT_MS',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (
        new URL(env.PAYMENT_BACKEND_URL).protocol !== 'https:' &&
        !env.PAYMENT_BACKEND_ALLOW_HTTP
      ) {
        context.addIssue({
          code: 'custom',
          path: ['PAYMENT_BACKEND_URL'],
          message:
            'must be https in production (or set PAYMENT_BACKEND_ALLOW_HTTP on a private network)',
        });
      }
      if (new URL(env.AUTH_JWKS_URL).protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          path: ['AUTH_JWKS_URL'],
          message: 'must be https in production',
        });
      }
    }
  });

export interface EngineConfig {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly port: number;
  readonly database: { readonly url: string; readonly poolMax: number };
  readonly auth: {
    readonly jwksUrl: string;
    readonly issuer: string;
    readonly audience: string;
  };
  readonly paymentBackend: {
    /** Base URL without a trailing slash. */
    readonly url: string;
    readonly internalApiKey: string;
    readonly timeoutMs: number;
  };
  readonly outbox: {
    readonly pollIntervalMs: number;
    readonly leaseSeconds: number;
    readonly baseBackoffMs: number;
    readonly maxBackoffMs: number;
    readonly alertAfterAttempts: number;
  };
  readonly dispatch: {
    readonly offerTtlSeconds: number;
    readonly pollIntervalMs?: number;
  };
}

export const ENGINE_CONFIG = Symbol('ENGINE_CONFIG');

/** Thrown at startup. Lists variable names only, never values. */
export class ConfigurationError extends Error {
  constructor(readonly variables: readonly string[]) {
    super(`Invalid or missing configuration: ${variables.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(
  source: NodeJS.ProcessEnv = process.env,
): EngineConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const names = new Set(
      parsed.error.issues.map((issue) => String(issue.path[0] ?? 'env')),
    );
    throw new ConfigurationError([...names].sort());
  }
  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    database: { url: env.DATABASE_URL, poolMax: env.DATABASE_POOL_MAX },
    auth: {
      jwksUrl: env.AUTH_JWKS_URL,
      issuer: env.AUTH_ISSUER,
      audience: env.AUTH_AUDIENCE,
    },
    paymentBackend: {
      url: env.PAYMENT_BACKEND_URL.replace(/\/+$/, ''),
      internalApiKey: env.PAYMENT_BACKEND_INTERNAL_API_KEY,
      timeoutMs: env.PAYMENT_BACKEND_TIMEOUT_MS,
    },
    outbox: {
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      leaseSeconds: env.OUTBOX_LEASE_SECONDS,
      baseBackoffMs: env.OUTBOX_BASE_BACKOFF_MS,
      maxBackoffMs: env.OUTBOX_MAX_BACKOFF_MS,
      alertAfterAttempts: env.OUTBOX_ALERT_AFTER_ATTEMPTS,
    },
    dispatch: {
      offerTtlSeconds: env.OFFER_TTL_SECONDS,
      pollIntervalMs: env.DISPATCH_POLL_INTERVAL_MS,
    },
  };
}
