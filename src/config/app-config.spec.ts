import { ConfigurationError, loadConfig, openReadinessItems } from './app-config';

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
    // Live keys need an explicit settlement decision (D-56 gate below); disabled is the safe one.
    expect(
      loadConfig(
        validEnv({ RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456', SETTLEMENT_PROVIDER: 'disabled' }),
      ).razorpay.mode,
    ).toBe('live');
  });

  describe('production-readiness gates', () => {
    const razorpayx = {
      PAYOUT_PROVIDER: 'razorpayx',
      RAZORPAYX_ACCOUNT_NUMBER: '7878780080316316',
      RAZORPAYX_WEBHOOK_SECRET: 'x_webhook_secret_value_0123456789abcdef',
    };
    const production = {
      NODE_ENV: 'production',
      RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456',
      SETTLEMENT_PROVIDER: 'disabled',
    };

    it('never assumes RazorpayX capabilities in production until they are confirmed (D-46, D-58)', () => {
      const refused = problemsFor(validEnv({ ...production, ...razorpayx })).join('\n');
      expect(refused).toMatch(/PAYOUT_PROVIDER: .*RAZORPAYX_CAPABILITIES_CONFIRMED=true/);
      // Same with live RazorpayX keys outside production.
      expect(
        problemsFor(
          validEnv({
            ...razorpayx,
            SETTLEMENT_PROVIDER: 'disabled',
            RAZORPAYX_KEY_ID: 'rzp_live_XyZ1234567',
            RAZORPAYX_KEY_SECRET: 'live_x_secret_value_1234',
          }),
        ).join(),
      ).toMatch(/RAZORPAYX_CAPABILITIES_CONFIRMED/);

      const confirmed = loadConfig(
        validEnv({ ...production, ...razorpayx, RAZORPAYX_CAPABILITIES_CONFIRMED: 'true' }),
      );
      expect(confirmed.payouts.provider).toBe('razorpayx');
      expect(confirmed.readiness.razorpayxCapabilitiesConfirmed).toBe(true);
      // Payouts off is always allowed, and is the default.
      expect(loadConfig(validEnv(production)).payouts.provider).toBeNull();
    });

    it('never trusts live settlement data until reconciliation is verified (D-56)', () => {
      const refused = problemsFor(
        validEnv({ ...production, SETTLEMENT_PROVIDER: 'razorpay' }),
      ).join('\n');
      expect(refused).toMatch(/SETTLEMENT_PROVIDER: .*SETTLEMENT_RECON_VERIFIED=true/);
      expect(problemsFor(validEnv({ RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456' })).join()).toMatch(
        /SETTLEMENT_RECON_VERIFIED/,
      );

      const verified = loadConfig(
        validEnv({
          ...production,
          SETTLEMENT_PROVIDER: 'razorpay',
          SETTLEMENT_RECON_VERIFIED: 'true',
        }),
      );
      expect(verified.settlements.provider).toBe('razorpay');
      expect(verified.readiness.settlementReconVerified).toBe(true);
      expect(loadConfig(validEnv(production)).settlements.provider).toBeNull();
    });

    it('does not gate development and tests with Razorpay test keys', () => {
      const config = loadConfig(validEnv(razorpayx));
      expect(config.payouts.provider).toBe('razorpayx');
      expect(config.settlements.provider).toBe('razorpay');
      expect(config.readiness).toEqual({
        razorpayxCapabilitiesConfirmed: false,
        settlementReconVerified: false,
        refundsProviderVerified: false,
      });
      // Razorpay refunds in test mode are not gated either.
      expect(loadConfig(validEnv({ REFUND_PROVIDER: 'razorpay' })).refunds.provider).toBe(
        'razorpay',
      );
    });

    it('never sends live refunds through Razorpay until they are verified (D-72)', () => {
      const refused = problemsFor(validEnv({ ...production, REFUND_PROVIDER: 'razorpay' })).join(
        '\n',
      );
      expect(refused).toMatch(/REFUND_PROVIDER: .*REFUNDS_PROVIDER_VERIFIED=true/);
      expect(
        problemsFor(
          validEnv({
            RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456',
            SETTLEMENT_PROVIDER: 'disabled',
            REFUND_PROVIDER: 'razorpay',
          }),
        ).join(),
      ).toMatch(/REFUNDS_PROVIDER_VERIFIED/);

      const verified = loadConfig(
        validEnv({ ...production, REFUND_PROVIDER: 'razorpay', REFUNDS_PROVIDER_VERIFIED: 'true' }),
      );
      expect(verified.refunds.provider).toBe('razorpay');
      expect(verified.readiness.refundsProviderVerified).toBe(true);
      // Provider refunds off is always allowed, and is the default.
      const off = loadConfig(validEnv(production));
      expect(off.refunds.provider).toBeNull();
      expect(openReadinessItems(off).join('\n')).toMatch(/D-72: .*provider refunds are off/);
    });

    it('keeps the refund policy open with safe defaults (L-7 to L-10, L-21)', () => {
      const config = loadConfig(validEnv());
      expect(config.refunds).toEqual({
        provider: null,
        partialAllowed: false,
        autoOnCancel: false,
        allowedCases: [
          'CANCELLED_BEFORE_HANDOVER',
          'CANCELLED_AFTER_HANDOVER',
          'UNDELIVERED_DROP',
          'COMPLETED_BOOKING',
        ],
      });
      expect(openReadinessItems(config).join('\n')).toMatch(
        /L-7 to L-10, L-21 .*admin-initiated only.*nothing is refunded, debited or recovered automatically; a refund returns all that is left of its source/,
      );
      // Automatic refunds on cancellation are not implemented.
      expect(problemsFor(validEnv({ REFUND_AUTO_ON_CANCEL: 'true' })).join()).toMatch(
        /REFUND_AUTO_ON_CANCEL/,
      );
      // The cases and partial refunds are configuration.
      const narrowed = loadConfig(
        validEnv({
          REFUND_ALLOWED_CASES: 'cancelled_before_handover, UNDELIVERED_DROP',
          REFUND_PARTIAL_ALLOWED: 'true',
        }),
      );
      expect(narrowed.refunds.allowedCases).toEqual([
        'CANCELLED_BEFORE_HANDOVER',
        'UNDELIVERED_DROP',
      ]);
      expect(narrowed.refunds.partialAllowed).toBe(true);
      expect(openReadinessItems(narrowed).join('\n')).toMatch(
        /partial refunds allowed .*cases: CANCELLED_BEFORE_HANDOVER, UNDELIVERED_DROP/,
      );
      expect(loadConfig(validEnv({ REFUND_ALLOWED_CASES: 'NONE' })).refunds.allowedCases).toEqual(
        [],
      );
      expect(problemsFor(validEnv({ REFUND_ALLOWED_CASES: 'ANY_TIME' })).join()).toMatch(
        /REFUND_ALLOWED_CASES/,
      );
    });

    it('lists the open items for the startup log', () => {
      const open = openReadinessItems(loadConfig(validEnv(production)));
      expect(open.join('\n')).toMatch(/D-46\/D-58/);
      expect(open.join('\n')).toMatch(/D-56/);
      expect(open.join('\n')).toMatch(/D-57/);
      const ready = openReadinessItems(
        loadConfig(
          validEnv({
            ...production,
            ...razorpayx,
            RAZORPAYX_CAPABILITIES_CONFIRMED: 'true',
            SETTLEMENT_PROVIDER: 'razorpay',
            SETTLEMENT_RECON_VERIFIED: 'true',
            COLLECTION_LINK_PROVIDER: 'razorpay_qr_code',
            REFUND_PROVIDER: 'razorpay',
            REFUNDS_PROVIDER_VERIFIED: 'true',
          }),
        ),
      );
      // TDS stays open until the CA confirms the rule, and the open business decisions with a
      // technical safe default are listed until they are decided.
      expect(ready).toEqual([
        expect.stringMatching(/^D-57/),
        expect.stringMatching(/^L-11\/D-70 .*held for admin review \(technical safe default\)/),
        expect.stringMatching(/^N5 driver pay .*nothing is refunded, compensated or recovered/),
        expect.stringMatching(/^L-7 to L-10, L-21 .*admin-initiated only/),
      ]);
    });

    it('holds the online part of a trip with an undelivered drop by default; the hold is configurable (L-11)', () => {
      expect(loadConfig(validEnv()).earnings.undeliveredDropHold).toBe(true);
      expect(
        loadConfig(validEnv({ EARNINGS_UNDELIVERED_DROP_HOLD: 'true' })).earnings
          .undeliveredDropHold,
      ).toBe(true);
      const off = loadConfig(validEnv({ EARNINGS_UNDELIVERED_DROP_HOLD: 'false' }));
      expect(off.earnings.undeliveredDropHold).toBe(false);
      // Switching it off is reported at startup (a warning in production).
      expect(openReadinessItems(off).join('\n')).toMatch(
        /L-11\/D-70 .*hold is OFF \(EARNINGS_UNDELIVERED_DROP_HOLD=false\)/,
      );
      expect(problemsFor(validEnv({ EARNINGS_UNDELIVERED_DROP_HOLD: 'maybe' })).join()).toMatch(
        /EARNINGS_UNDELIVERED_DROP_HOLD/,
      );
    });

    it('collects with a UPI QR when live; a payment-link QR is for test mode only (D-47)', () => {
      expect(
        problemsFor(
          validEnv({ ...production, COLLECTION_LINK_PROVIDER: 'razorpay_payment_link' }),
        ).join('\n'),
      ).toMatch(/COLLECTION_LINK_PROVIDER: .*razorpay_qr_code/);
      expect(
        problemsFor(
          validEnv({
            RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456',
            SETTLEMENT_PROVIDER: 'disabled',
            COLLECTION_LINK_PROVIDER: 'razorpay_payment_link',
          }),
        ).join(),
      ).toMatch(/COLLECTION_LINK_PROVIDER/);
      expect(
        loadConfig(validEnv({ ...production, COLLECTION_LINK_PROVIDER: 'razorpay_qr_code' }))
          .collections.product,
      ).toBe('QR_CODE');
      // Test mode keeps payment links, because Razorpay QR codes can't be paid there.
      const testMode = loadConfig(validEnv({ COLLECTION_LINK_PROVIDER: 'razorpay_payment_link' }));
      expect(testMode.collections.product).toBe('PAYMENT_LINK');
      expect(openReadinessItems(testMode).join('\n')).toMatch(/D-47: .*test mode only/);
    });
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
    expect(config.collections).toEqual({ product: null, simulated: false, linkTtlMinutes: 30 });
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

    // Simulated collection QR codes (Phase 4 local end-to-end runs): same rule.
    const qr = { COLLECTION_LINK_PROVIDER: 'simulated' };
    const qrConfig = loadConfig(validEnv(qr));
    expect(qrConfig.simulation.enabled).toBe(true);
    expect(qrConfig.collections).toMatchObject({ product: 'QR_CODE', simulated: true });
    expect(openReadinessItems(qrConfig).join('\n')).toMatch(/D-47: .*simulated/);
    expect(loadConfig(validEnv()).collections.simulated).toBe(false);
    expect(problemsFor(validEnv({ ...qr, NODE_ENV: 'production' })).join()).toMatch(
      /COLLECTION_LINK_PROVIDER/,
    );
    expect(
      problemsFor(validEnv({ ...qr, RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456' })).join(),
    ).toMatch(/COLLECTION_LINK_PROVIDER/);

    // Simulated refunds (Phase 6 local end-to-end runs): same rule.
    const refunds = loadConfig(validEnv({ REFUND_PROVIDER: 'simulated' }));
    expect(refunds.simulation.enabled).toBe(true);
    expect(refunds.refunds.provider).toBe('simulated');
    expect(openReadinessItems(refunds).join('\n')).toMatch(/D-72: provider refunds are simulated/);
    expect(
      problemsFor(validEnv({ REFUND_PROVIDER: 'simulated', NODE_ENV: 'production' })).join(),
    ).toMatch(/REFUND_PROVIDER/);
    expect(
      problemsFor(
        validEnv({ REFUND_PROVIDER: 'simulated', RAZORPAY_KEY_ID: 'rzp_live_AbCdEf123456' }),
      ).join(),
    ).toMatch(/REFUND_PROVIDER/);
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

describe('reconciliation config (payment flow Phase 7)', () => {
  it('runs recovery every 5 minutes and reconciliation hourly by default, reading the providers', () => {
    const config = loadConfig(validEnv());
    expect(config.reconciliation).toEqual({
      recoveryIntervalMinutes: 5,
      recoveryMinAgeMinutes: 5,
      intervalMinutes: 60,
      providerChecks: true,
      lookbackDays: 3,
      minAgeMinutes: 15,
    });
    // Both jobs on: nothing to report at startup.
    expect(openReadinessItems(config).join('\n')).not.toMatch(
      /recovery job off|reconciliation off/,
    );
  });

  it('can switch either job off, and says so at startup', () => {
    const off = loadConfig(
      validEnv({
        COLLECTION_RECOVERY_INTERVAL_MINUTES: '0',
        RECONCILIATION_INTERVAL_MINUTES: '0',
        RECONCILIATION_PROVIDER_CHECKS: 'false',
        RECONCILIATION_LOOKBACK_DAYS: '7',
      }),
    );
    expect(off.reconciliation).toMatchObject({
      recoveryIntervalMinutes: 0,
      intervalMinutes: 0,
      providerChecks: false,
      lookbackDays: 7,
    });
    const items = openReadinessItems(off).join('\n');
    expect(items).toMatch(/Collection recovery job off \(COLLECTION_RECOVERY_INTERVAL_MINUTES=0\)/);
    expect(items).toMatch(/Scheduled reconciliation off \(RECONCILIATION_INTERVAL_MINUTES=0\)/);
  });

  it.each([
    ['COLLECTION_RECOVERY_INTERVAL_MINUTES', '-1'],
    ['COLLECTION_RECOVERY_INTERVAL_MINUTES', '1441'],
    ['COLLECTION_RECOVERY_MIN_AGE_MINUTES', '1441'],
    ['RECONCILIATION_INTERVAL_MINUTES', '10081'],
    ['RECONCILIATION_INTERVAL_MINUTES', '1.5'],
    ['RECONCILIATION_LOOKBACK_DAYS', '0'],
    ['RECONCILIATION_LOOKBACK_DAYS', '32'],
    ['RECONCILIATION_MIN_AGE_MINUTES', 'soon'],
    ['RECONCILIATION_PROVIDER_CHECKS', 'maybe'],
  ])('refuses %s=%s', (name, value) => {
    expect(problemsFor(validEnv({ [name]: value })).join()).toMatch(new RegExp(name));
  });
});
