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
    // Optional lab containment mode; never enables any production integration.
    MR_SYNTHETIC_ONLY: booleanString.default(false),
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
    if (env.MR_SYNTHETIC_ONLY) {
      const require = (ok: boolean, name: string) => {
        if (!ok)
          context.addIssue({
            code: 'custom',
            path: [name],
            message: 'synthetic isolation required',
          });
      };
      let database: URL | undefined;
      try {
        database = new URL(env.DATABASE_URL);
      } catch {
        /* report names only */
      }
      require(env.NODE_ENV === 'production', 'NODE_ENV');
      require(env.PORT === 3000, 'PORT');
      require(database !== undefined &&
        database.hostname === '172.29.63.2' &&
        database.port === '5432' &&
        database.pathname === '/mr_engine_synthetic_test' &&
        database.username === 'engine_ci_runtime' &&
        database.password.startsWith('dummy_engine_ci_'), 'DATABASE_URL');
      require(env.DATABASE_POOL_MAX <= 5, 'DATABASE_POOL_MAX');
      require(env.AUTH_JWKS_URL ===
        'https://127.0.0.1:3443/jwks', 'AUTH_JWKS_URL');
      require(env.AUTH_ISSUER === 'https://engine-ci.invalid', 'AUTH_ISSUER');
      require(env.AUTH_AUDIENCE === 'mr-engine-ci', 'AUTH_AUDIENCE');
      require(env.PAYMENT_BACKEND_URL ===
        'https://127.0.0.1:3443', 'PAYMENT_BACKEND_URL');
      require(env.PAYMENT_BACKEND_INTERNAL_API_KEY.startsWith(
        'dummy_engine_ci_',
      ), 'PAYMENT_BACKEND_INTERNAL_API_KEY');
      require(env.OUTBOX_POLL_INTERVAL_MS === 0, 'OUTBOX_POLL_INTERVAL_MS');
      require(env.DISPATCH_POLL_INTERVAL_MS === 0, 'DISPATCH_POLL_INTERVAL_MS');
    }
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
  if (source.MR_SYNTHETIC_ONLY === 'true') {
    const forbidden = Object.keys(source).filter(
      (name) =>
        /^(AWS_|AZURE_|RAZORPAY_|FCM_|GOOGLE_APPLICATION_CREDENTIALS$|FIREBASE_SERVICE_ACCOUNT|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/.test(
          name,
        ) ||
        (name === 'NODE_TLS_REJECT_UNAUTHORIZED' && source[name] !== '1'),
    );
    if (forbidden.length) throw new ConfigurationError(forbidden.sort());
  }
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
