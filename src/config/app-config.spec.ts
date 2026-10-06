import { ConfigurationError, loadConfig } from './app-config';

const KEY_SECRET = 'unit_secret_value_1234';
const WEBHOOK_SECRET = 'unit_webhook_secret_value_0123456789abcd';

function validEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    AUTH_ISSUER: 'https://securetoken.google.com/demo-project',
    AUTH_AUDIENCE: 'demo-project',
    RAZORPAY_KEY_ID: 'rzp_test_AbCdEf123456',
    RAZORPAY_KEY_SECRET: KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    WALLET_TOPUP_MAX_PAISE: '500000',
    ADMIN_ADJUSTMENT_MAX_PAISE: '1000000',
    ...overrides,
  };
}

function problemsFor(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return [...error.problems];
    }
    throw error;
  }
  throw new Error('Expected a ConfigurationError');
}

describe('loadConfig', () => {
  it('builds a typed config with safe defaults', () => {
    const config = loadConfig(validEnv());
    expect(config.port).toBe(3000);
    expect(config.swaggerEnabled).toBe(false);
    expect(config.auth.provider).toBe('firebase');
    expect(config.auth.jwksUrl).toContain('securetoken@system.gserviceaccount.com');
    expect(config.razorpay.mode).toBe('test');
    expect(config.razorpay.apiBaseUrl).toBe('https://api.razorpay.com');
    expect(config.wallet.topUpMinPaise).toBe(100n);
    expect(config.wallet.topUpMaxPaise).toBe(500_000n);
    expect(Object.isFrozen(config.razorpay)).toBe(true);
  });

  it('detects live keys', () => {
    expect(loadConfig(validEnv({ RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456' })).razorpay.mode).toBe(
      'live',
    );
  });

  it('accepts both webhook secrets during a rotation', () => {
    const previous = 'previous_webhook_secret_value_0123456789';
    const config = loadConfig(validEnv({ RAZORPAY_WEBHOOK_SECRET_PREVIOUS: previous }));
    expect(config.razorpay.webhookSecrets).toEqual([WEBHOOK_SECRET, previous]);
  });

  it('lists every missing variable by name, treating blank values as missing', () => {
    const problems = problemsFor({
      ...validEnv(),
      RAZORPAY_KEY_SECRET: '  ',
      WALLET_TOPUP_MAX_PAISE: '',
    });
    expect(problems.join('\n')).toMatch(/RAZORPAY_KEY_SECRET/);
    expect(problems.join('\n')).toMatch(/WALLET_TOPUP_MAX_PAISE/);
  });

  it('never includes secret values in error messages', () => {
    const problems = problemsFor(
      validEnv({ RAZORPAY_KEY_ID: 'bad-key', RAZORPAY_WEBHOOK_SECRET: 'short' }),
    );
    const message = problems.join('\n');
    expect(message).toMatch(/RAZORPAY_KEY_ID/);
    expect(message).toMatch(/RAZORPAY_WEBHOOK_SECRET/);
    expect(message).not.toContain(KEY_SECRET);
    expect(message).not.toContain('bad-key');
  });

  it('rejects a maximum below the minimum', () => {
    expect(
      problemsFor(
        validEnv({ WALLET_TOPUP_MIN_PAISE: '1000', WALLET_TOPUP_MAX_PAISE: '500' }),
      ).join(),
    ).toMatch(/WALLET_TOPUP_MAX_PAISE/);
  });

  it('rejects top-up limits outside what Razorpay allows', () => {
    expect(problemsFor(validEnv({ WALLET_TOPUP_MIN_PAISE: '50' })).join()).toMatch(
      /WALLET_TOPUP_MIN_PAISE/,
    );
    expect(problemsFor(validEnv({ WALLET_TOPUP_MAX_PAISE: '50000001' })).join()).toMatch(
      /WALLET_TOPUP_MAX_PAISE/,
    );
  });

  it('rejects CORS entries that are not plain origins', () => {
    expect(
      problemsFor(validEnv({ CORS_ORIGINS: 'https://admin.example.com/path' })).join(),
    ).toMatch(/CORS_ORIGINS/);
    expect(
      loadConfig(validEnv({ CORS_ORIGINS: 'https://admin.example.com, http://localhost:5173' }))
        .corsOrigins,
    ).toEqual(['https://admin.example.com', 'http://localhost:5173']);
  });

  it('enforces production-only rules', () => {
    const problems = problemsFor(
      validEnv({
        NODE_ENV: 'production',
        RAZORPAY_API_BASE_URL: 'http://localhost:9999',
        AUTH_JWKS_URL: 'http://keys.example.com/jwks',
        CORS_ORIGINS: 'http://admin.example.com',
      }),
    ).join('\n');
    expect(problems).toMatch(/RAZORPAY_API_BASE_URL/);
    expect(problems).toMatch(/AUTH_JWKS_URL/);
    expect(problems).toMatch(/CORS_ORIGINS/);
  });

  it('keeps online collection, payouts, the scheduler and the internal API off by default', () => {
    const config = loadConfig(validEnv());
    expect(config.collections).toEqual({ product: null, linkTtlMinutes: 30 });
    expect(config.payouts).toMatchObject({
      provider: null,
      razorpayx: null,
      mode: 'IMPS',
      queueIfLowBalance: true,
      schedule: { enabled: false, autoExecute: false, timeZone: 'Asia/Kolkata' },
    });
    expect(config.internalApi.keys).toEqual([]);
  });

  it('maps the collection provider setting to a product', () => {
    expect(
      loadConfig(validEnv({ COLLECTION_LINK_PROVIDER: 'razorpay_payment_link' })).collections
        .product,
    ).toBe('PAYMENT_LINK');
    expect(
      loadConfig(validEnv({ COLLECTION_LINK_PROVIDER: 'razorpay_qr_code' })).collections.product,
    ).toBe('QR_CODE');
    expect(problemsFor(validEnv({ COLLECTION_LINK_TTL_MINUTES: '10' })).join()).toMatch(
      /COLLECTION_LINK_TTL_MINUTES/,
    );
  });

  it('requires the RazorpayX account and webhook secret when payouts are enabled', () => {
    const problems = problemsFor(validEnv({ PAYOUT_PROVIDER: 'razorpayx' })).join('\n');
    expect(problems).toMatch(/RAZORPAYX_ACCOUNT_NUMBER/);
    expect(problems).toMatch(/RAZORPAYX_WEBHOOK_SECRET/);

    const config = loadConfig(
      validEnv({
        PAYOUT_PROVIDER: 'razorpayx',
        RAZORPAYX_ACCOUNT_NUMBER: '7878780080316316',
        RAZORPAYX_WEBHOOK_SECRET: 'x_webhook_secret_value_0123456789abcdef',
      }),
    );
    // Without separate RazorpayX keys, the standard Razorpay keys are used.
    expect(config.payouts.razorpayx).toMatchObject({
      accountNumber: '7878780080316316',
      keyId: 'rzp_test_AbCdEf123456',
    });
    expect(problemsFor(validEnv({ RAZORPAYX_KEY_ID: 'rzp_test_OnlyTheId1' })).join()).toMatch(
      /RAZORPAYX_KEY_ID/,
    );
  });

  it('schedules payouts every Monday at 11:00 IST by default, configurable per deployment', () => {
    const payouts = {
      PAYOUT_PROVIDER: 'razorpayx',
      RAZORPAYX_ACCOUNT_NUMBER: '7878780080316316',
      RAZORPAYX_WEBHOOK_SECRET: 'x_webhook_secret_value_0123456789abcdef',
    };
    expect(
      loadConfig(validEnv({ ...payouts, PAYOUT_SCHEDULE_ENABLED: 'true' })).payouts.schedule,
    ).toEqual({
      enabled: true,
      weekday: 1,
      time: '11:00',
      timeZone: 'Asia/Kolkata',
      autoExecute: false,
    });
    expect(problemsFor(validEnv({ PAYOUT_SCHEDULE_ENABLED: 'true' })).join()).toMatch(
      /PAYOUT_SCHEDULE_ENABLED/,
    );
    expect(problemsFor(validEnv({ ...payouts, PAYOUT_SCHEDULE_WEEKDAY: '8' })).join()).toMatch(
      /PAYOUT_SCHEDULE_WEEKDAY/,
    );
    expect(problemsFor(validEnv({ ...payouts, PAYOUT_SCHEDULE_TIME: '25:00' })).join()).toMatch(
      /PAYOUT_SCHEDULE_TIME/,
    );
    expect(problemsFor(validEnv({ PAYOUT_AUTO_EXECUTE: 'true' })).join()).toMatch(
      /PAYOUT_AUTO_EXECUTE/,
    );
    expect(
      problemsFor(validEnv({ ...payouts, PAYOUT_SCHEDULE_TIMEZONE: 'Mars/Olympus' })).join(),
    ).toMatch(/PAYOUT_SCHEDULE_TIMEZONE/);
    expect(
      loadConfig(
        validEnv({
          ...payouts,
          PAYOUT_SCHEDULE_ENABLED: 'true',
          PAYOUT_SCHEDULE_WEEKDAY: '1',
          PAYOUT_SCHEDULE_TIME: '10:00',
        }),
      ).payouts.schedule,
    ).toMatchObject({ enabled: true, weekday: 1, time: '10:00' });
  });

  it('tracks merchant settlements through Razorpay by default and refuses TDS until a rule exists', () => {
    const config = loadConfig(validEnv());
    expect(config.settlements).toEqual({
      provider: 'razorpay',
      syncIntervalMinutes: 60,
      lookbackDays: 7,
      overdueDays: 5,
    });
    expect(config.tax.tdsEnabled).toBe(false);
    expect(config.simulation.enabled).toBe(false);
    expect(problemsFor(validEnv({ TDS_ENABLED: 'true' })).join()).toMatch(/TDS_ENABLED/);
    expect(problemsFor(validEnv({ SETTLEMENT_SYNC_LOOKBACK_DAYS: '0' })).join()).toMatch(
      /SETTLEMENT_SYNC_LOOKBACK_DAYS/,
    );
  });

  it('allows simulated providers only outside production with test keys', () => {
    const simulated = { SETTLEMENT_PROVIDER: 'simulated', PAYOUT_PROVIDER: 'simulated' };
    expect(loadConfig(validEnv(simulated)).simulation.enabled).toBe(true);
    expect(problemsFor(validEnv({ ...simulated, NODE_ENV: 'production' })).join()).toMatch(
      /SETTLEMENT_PROVIDER/,
    );
    expect(
      problemsFor(validEnv({ ...simulated, RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456' })).join(),
    ).toMatch(/PAYOUT_PROVIDER/);
  });

  it('rejects weak internal API keys without echoing them', () => {
    const problems = problemsFor(validEnv({ INTERNAL_API_KEYS: 'short-key' })).join();
    expect(problems).toMatch(/INTERNAL_API_KEYS/);
    expect(problems).not.toContain('short-key');
    expect(
      loadConfig(validEnv({ INTERNAL_API_KEYS: `${'a'.repeat(32)}, ${'b'.repeat(40)}` }))
        .internalApi.keys,
    ).toHaveLength(2);
  });

  it('rejects non-postgres database URLs', () => {
    expect(problemsFor(validEnv({ DATABASE_URL: 'mysql://user:pass@host/db' })).join()).toMatch(
      /DATABASE_URL/,
    );
  });
});
