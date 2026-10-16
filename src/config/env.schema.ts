import { z } from 'zod';

export const FIREBASE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const RAZORPAY_PRODUCTION_API_BASE_URL = 'https://api.razorpay.com';

/** Razorpay's documented maximum for a single order (Rs 5,00,000). */
export const RAZORPAY_MAX_ORDER_PAISE = 50_000_000;
/** Razorpay's documented minimum for an INR order (Rs 1). */
export const RAZORPAY_MIN_ORDER_PAISE = 100;

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

const httpsOrHttpUrl = z.url({ protocol: /^https?$/ });

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    CORS_ORIGINS: z.string().optional(),
    SWAGGER_ENABLED: booleanString.default(false),

    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// or postgresql:// connection string'),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    AUTH_PROVIDER: z
      .string()
      .regex(/^[a-z][a-z0-9_-]{1,29}$/)
      .default('firebase'),
    AUTH_JWKS_URL: httpsOrHttpUrl.default(FIREBASE_JWKS_URL),
    AUTH_ISSUER: z.string().min(1),
    AUTH_AUDIENCE: z.string().min(1),

    RAZORPAY_KEY_ID: z
      .string()
      .regex(/^rzp_(test|live)_[A-Za-z0-9]{6,}$/, 'must look like rzp_test_xxx or rzp_live_xxx'),
    RAZORPAY_KEY_SECRET: z.string().min(16),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters'),
    RAZORPAY_WEBHOOK_SECRET_PREVIOUS: z
      .string()
      .min(32, 'must be at least 32 characters')
      .optional(),
    RAZORPAY_API_BASE_URL: httpsOrHttpUrl.default(RAZORPAY_PRODUCTION_API_BASE_URL),
    RAZORPAY_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(4000),

    WALLET_TOPUP_MIN_PAISE: z.coerce
      .number()
      .int()
      .min(RAZORPAY_MIN_ORDER_PAISE)
      .default(RAZORPAY_MIN_ORDER_PAISE),
    WALLET_TOPUP_MAX_PAISE: z.coerce.number().int().max(RAZORPAY_MAX_ORDER_PAISE),
    ADMIN_ADJUSTMENT_MAX_PAISE: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),

    // Server-to-server API used by the trip engine. Comma-separated keys (current, then
    // previous during a rotation). Unset means the internal API is disabled.
    INTERNAL_API_KEYS: z.string().optional(),

    // Pickup/delivery online collection (booking-linked QR). Live: razorpay_qr_code (a UPI QR any
    // UPI app can pay, D-47). razorpay_payment_link draws a QR of a payment link and is allowed
    // only in test mode, where Razorpay QR codes can't be paid. simulated: in-memory QR codes paid
    // through /v1/dev/simulate (local end-to-end runs only; non-production, test keys).
    COLLECTION_LINK_PROVIDER: z
      .enum(['disabled', 'razorpay_payment_link', 'razorpay_qr_code', 'simulated'])
      .default('disabled'),
    // How long a collection QR stays payable. Razorpay needs at least 15 minutes for payment links;
    // QR codes are capped at 120 minutes.
    COLLECTION_LINK_TTL_MINUTES: z.coerce.number().int().min(16).max(120).default(30),

    // Merchant settlement tracking (OPEN_DECISIONS D-45): an ONLINE earning becomes payable only
    // once Razorpay reports its customer payment as settled to Nikhil Enterprises.
    //   razorpay   settlement reconciliation API (production)
    //   simulated  in-memory settlements fed through /v1/dev/simulate (non-production, test keys)
    //   disabled   nothing is ever settled, so no ONLINE earning becomes payable
    SETTLEMENT_PROVIDER: z.enum(['razorpay', 'simulated', 'disabled']).default('razorpay'),
    // Production-readiness gate (OPEN_DECISIONS D-56). Razorpay test mode never settles, so the
    // settlement reconciliation fields have only been checked against the documentation. Set to
    // true only after they were verified on Nikhil Enterprises' live account; until then
    // SETTLEMENT_PROVIDER=razorpay is refused in production and with live keys (use disabled:
    // ONLINE earnings then stay AWAITING_SETTLEMENT and nothing is paid out).
    SETTLEMENT_RECON_VERIFIED: booleanString.default(false),
    // How often settlements are pulled from Razorpay (0 = only on webhooks, admin request and
    // before each scheduled payout batch), and how many days back each pull looks.
    SETTLEMENT_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
    SETTLEMENT_SYNC_LOOKBACK_DAYS: z.coerce.number().int().min(1).max(31).default(7),
    // An ONLINE earning still waiting for its settlement after this many days is reported by
    // reconciliation for manual review.
    SETTLEMENT_OVERDUE_DAYS: z.coerce.number().int().min(1).max(60).default(5),

    // Tax deducted at source on driver earnings/payouts. Must stay false until a CA confirms the
    // rule and a versioned tax rule is implemented (OPEN_DECISIONS D-57); true is refused.
    TDS_ENABLED: booleanString.default(false),

    // A completed trip with a drop resolved UNDELIVERED (OPEN_DECISIONS L-11 / D-70: an open
    // business decision, not a final rule). true is the technical safe default: the online part
    // of that trip's earning starts ON_HOLD (UNDELIVERED_STOP_REVIEW) until an admin reviews and
    // releases it. false: it follows the normal rules (payable once every online collection is
    // settled). Either way the earning carries only the money actually collected, and nothing
    // moves on its own: no refund, no wallet debit or credit.
    EARNINGS_UNDELIVERED_DROP_HOLD: booleanString.default(true),

    // How long a fare quote can be booked (seconds). After that the app must ask for a new
    // quote, so a customer always pays a price calculated by the current pricing version.
    FARE_QUOTE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
    // Most drops one booking may have. 5 is a technical default, not a business decision: the
    // final maximum is open (OPEN_DECISIONS D-29). The database allows up to 25 so a change
    // needs no migration.
    FARE_MAX_DROPS: z.coerce.number().int().min(1).max(25).default(5),

    // Weekly driver payouts (RazorpayX). Disabled until the account is activated. "simulated"
    // (non-production, test keys only) moves payouts and bank validations through
    // /v1/dev/simulate instead of RazorpayX.
    PAYOUT_PROVIDER: z.enum(['disabled', 'razorpayx', 'simulated']).default('disabled'),
    // Production-readiness gate (OPEN_DECISIONS D-46, D-58). Set to true only once Nikhil
    // Enterprises' RazorpayX account is activated and Payouts, Fund Account Validation (penny
    // drop), the payout IP allowlist and the payout/validation webhooks are confirmed on it.
    // Until then PAYOUT_PROVIDER=razorpayx is refused in production and with live keys.
    RAZORPAYX_CAPABILITIES_CONFIRMED: booleanString.default(false),
    RAZORPAYX_ACCOUNT_NUMBER: z
      .string()
      .regex(/^[A-Za-z0-9]{6,40}$/, 'must be the RazorpayX account number (letters and digits)')
      .optional(),
    // Optional: separate API keys for RazorpayX. Defaults to RAZORPAY_KEY_ID/SECRET.
    RAZORPAYX_KEY_ID: z
      .string()
      .regex(/^rzp_(test|live)_[A-Za-z0-9]{6,}$/, 'must look like rzp_test_xxx or rzp_live_xxx')
      .optional(),
    RAZORPAYX_KEY_SECRET: z.string().min(16).optional(),
    RAZORPAYX_WEBHOOK_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
    RAZORPAYX_WEBHOOK_SECRET_PREVIOUS: z
      .string()
      .min(32, 'must be at least 32 characters')
      .optional(),
    PAYOUT_MODE: z.enum(['IMPS', 'NEFT', 'RTGS']).default('IMPS'),
    // Shown on the driver's bank statement. RazorpayX allows 30 letters, digits and spaces.
    PAYOUT_NARRATION: z
      .string()
      .regex(/^[A-Za-z0-9 ]{1,30}$/, 'must be 1-30 letters, digits or spaces')
      .default('Nikhil Enterprises Payout'),
    PAYOUT_QUEUE_IF_LOW_BALANCE: booleanString.default(true),
    PAYOUT_SCHEDULE_ENABLED: booleanString.default(false),
    // ISO weekday (1 = Monday ... 7 = Sunday) and local time of the weekly run. Approved business
    // rule (OPEN_DECISIONS D-48): every Monday at 11:00 IST. Change it here, not in code.
    PAYOUT_SCHEDULE_WEEKDAY: z.coerce.number().int().min(1).max(7).default(1),
    PAYOUT_SCHEDULE_TIME: z
      .string()
      .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'must be HH:MM (24-hour)')
      .default('11:00'),
    PAYOUT_SCHEDULE_TIMEZONE: z
      .string()
      .refine(isValidTimeZone, 'must be an IANA time zone such as Asia/Kolkata')
      .default('Asia/Kolkata'),
    // When false (default), the scheduler only prepares the weekly batch; an admin executes it.
    PAYOUT_AUTO_EXECUTE: booleanString.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.WALLET_TOPUP_MAX_PAISE < env.WALLET_TOPUP_MIN_PAISE) {
      ctx.addIssue({
        code: 'custom',
        path: ['WALLET_TOPUP_MAX_PAISE'],
        message: 'must be greater than or equal to WALLET_TOPUP_MIN_PAISE',
      });
    }

    for (const key of parseCsv(env.INTERNAL_API_KEYS)) {
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['INTERNAL_API_KEYS'],
          message: 'every key must be 32-128 characters of letters, digits, "-" or "_"',
        });
        break;
      }
    }

    if (env.PAYOUT_PROVIDER === 'razorpayx') {
      if (!env.RAZORPAYX_ACCOUNT_NUMBER) {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAYX_ACCOUNT_NUMBER'],
          message: 'is required when PAYOUT_PROVIDER is razorpayx',
        });
      }
      if (!env.RAZORPAYX_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAYX_WEBHOOK_SECRET'],
          message: 'is required when PAYOUT_PROVIDER is razorpayx',
        });
      }
    }
    if ((env.RAZORPAYX_KEY_ID === undefined) !== (env.RAZORPAYX_KEY_SECRET === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['RAZORPAYX_KEY_ID'],
        message: 'RAZORPAYX_KEY_ID and RAZORPAYX_KEY_SECRET must be set together',
      });
    }
    if (env.PAYOUT_SCHEDULE_ENABLED && env.PAYOUT_PROVIDER === 'disabled') {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYOUT_SCHEDULE_ENABLED'],
        message: 'needs PAYOUT_PROVIDER to be configured',
      });
    }
    if (env.TDS_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['TDS_ENABLED'],
        message:
          'TDS is not implemented until a CA confirms the rule (OPEN_DECISIONS D-57); keep it false',
      });
    }
    // Simulated providers fake money movement, so they never run in production or with live keys.
    const simulated = [
      ['SETTLEMENT_PROVIDER', env.SETTLEMENT_PROVIDER],
      ['PAYOUT_PROVIDER', env.PAYOUT_PROVIDER],
      ['COLLECTION_LINK_PROVIDER', env.COLLECTION_LINK_PROVIDER],
    ].filter(([, provider]) => provider === 'simulated');
    for (const [name] of simulated) {
      if (env.NODE_ENV === 'production' || !env.RAZORPAY_KEY_ID.startsWith('rzp_test_')) {
        ctx.addIssue({
          code: 'custom',
          path: [name ?? 'PROVIDER'],
          message: 'simulated is only allowed outside production with Razorpay test keys',
        });
      }
    }
    // Production-readiness gates: capabilities nobody has confirmed on the live accounts yet are
    // never assumed (OPEN_DECISIONS D-46, D-56, D-58).
    const liveRazorpay =
      env.NODE_ENV === 'production' || env.RAZORPAY_KEY_ID.startsWith('rzp_live_');
    const liveRazorpayX =
      env.NODE_ENV === 'production' ||
      (env.RAZORPAYX_KEY_ID ?? env.RAZORPAY_KEY_ID).startsWith('rzp_live_');
    if (
      env.PAYOUT_PROVIDER === 'razorpayx' &&
      liveRazorpayX &&
      !env.RAZORPAYX_CAPABILITIES_CONFIRMED
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYOUT_PROVIDER'],
        message:
          'razorpayx needs RAZORPAYX_CAPABILITIES_CONFIRMED=true once the RazorpayX account is activated and Payouts, Fund Account Validation and its webhooks are confirmed (OPEN_DECISIONS D-46, D-58); keep PAYOUT_PROVIDER=disabled until then',
      });
    }
    // Decided (D-47): live pickup/delivery collection uses Razorpay UPI QR Codes, which any UPI
    // app can scan and pay. A QR of a payment link is for test mode only.
    if (env.COLLECTION_LINK_PROVIDER === 'razorpay_payment_link' && liveRazorpay) {
      ctx.addIssue({
        code: 'custom',
        path: ['COLLECTION_LINK_PROVIDER'],
        message:
          'razorpay_payment_link is for test mode only; live collection uses razorpay_qr_code (UPI QR, OPEN_DECISIONS D-47), or disabled until QR Codes is enabled on the Razorpay account',
      });
    }
    if (env.SETTLEMENT_PROVIDER === 'razorpay' && liveRazorpay && !env.SETTLEMENT_RECON_VERIFIED) {
      ctx.addIssue({
        code: 'custom',
        path: ['SETTLEMENT_PROVIDER'],
        message:
          'razorpay needs SETTLEMENT_RECON_VERIFIED=true once settlement reconciliation is verified on the live account (OPEN_DECISIONS D-56); use SETTLEMENT_PROVIDER=disabled until then',
      });
    }
    if (env.PAYOUT_AUTO_EXECUTE && !env.PAYOUT_SCHEDULE_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['PAYOUT_AUTO_EXECUTE'],
        message: 'only applies when PAYOUT_SCHEDULE_ENABLED is true',
      });
    }

    for (const origin of parseCsv(env.CORS_ORIGINS)) {
      if (!isValidOrigin(origin, env.NODE_ENV === 'production')) {
        ctx.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'every entry must be an origin like https://admin.example.com',
        });
        break;
      }
    }

    if (env.NODE_ENV === 'production') {
      if (env.RAZORPAY_API_BASE_URL !== RAZORPAY_PRODUCTION_API_BASE_URL) {
        ctx.addIssue({
          code: 'custom',
          path: ['RAZORPAY_API_BASE_URL'],
          message: `must be ${RAZORPAY_PRODUCTION_API_BASE_URL} in production`,
        });
      }
      if (!env.AUTH_JWKS_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['AUTH_JWKS_URL'],
          message: 'must use https in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function isValidOrigin(candidate: string, requireHttps: boolean): boolean {
  try {
    const url = new URL(candidate);
    const allowedProtocol = requireHttps
      ? url.protocol === 'https:'
      : /^https?:$/.test(url.protocol);
    return allowedProtocol && url.origin === candidate;
  } catch {
    return false;
  }
}
