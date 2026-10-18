import {
  ConfigurationError,
  FIREBASE_JWKS_URL,
  loadConfig,
} from './engine-config';

const KEY = 'engine_unit_test_internal_key_0123456789ab';

const base = (overrides: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: 'postgresql://user:secret-password@localhost:5432/engine',
  AUTH_ISSUER: 'https://securetoken.google.com/multipleride-test',
  AUTH_AUDIENCE: 'multipleride-test',
  PAYMENT_BACKEND_URL: 'https://payments.example.test/',
  PAYMENT_BACKEND_INTERNAL_API_KEY: KEY,
  ...overrides,
});

const failure = (
  env: Record<string, string | undefined>,
): ConfigurationError => {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a configuration error');
};

describe('loadConfig', () => {
  it('applies the defaults and trims the backend URL', () => {
    const config = loadConfig(base());
    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 3000,
      database: { poolMax: 10 },
      auth: { jwksUrl: FIREBASE_JWKS_URL, audience: 'multipleride-test' },
      paymentBackend: {
        url: 'https://payments.example.test',
        internalApiKey: KEY,
        timeoutMs: 5_000,
      },
      outbox: {
        pollIntervalMs: 1_000,
        leaseSeconds: 30,
        baseBackoffMs: 1_000,
        maxBackoffMs: 300_000,
        alertAfterAttempts: 8,
      },
      dispatch: { offerTtlSeconds: 15 },
    });
  });

  it('requires the database, Firebase project and payment backend settings', () => {
    const error = failure({});
    expect(error.variables).toEqual([
      'AUTH_AUDIENCE',
      'AUTH_ISSUER',
      'DATABASE_URL',
      'PAYMENT_BACKEND_INTERNAL_API_KEY',
      'PAYMENT_BACKEND_URL',
    ]);
  });

  it('names the variables only, never their values', () => {
    const error = failure(
      base({
        DATABASE_URL: 'mysql://user:secret-password@host/db',
        PAYMENT_BACKEND_INTERNAL_API_KEY: 'short',
      }),
    );
    expect(error.variables).toEqual([
      'DATABASE_URL',
      'PAYMENT_BACKEND_INTERNAL_API_KEY',
    ]);
    expect(error.message).not.toContain('secret-password');
    expect(error.message).not.toContain('short');
  });

  it('accepts only internal keys the payment backend accepts', () => {
    expect(
      failure(base({ PAYMENT_BACKEND_INTERNAL_API_KEY: 'x'.repeat(31) }))
        .variables,
    ).toEqual(['PAYMENT_BACKEND_INTERNAL_API_KEY']);
    expect(
      failure(base({ PAYMENT_BACKEND_INTERNAL_API_KEY: `${'x'.repeat(40)}!` }))
        .variables,
    ).toEqual(['PAYMENT_BACKEND_INTERNAL_API_KEY']);
    expect(
      loadConfig(base({ PAYMENT_BACKEND_INTERNAL_API_KEY: 'A'.repeat(128) }))
        .paymentBackend.internalApiKey,
    ).toHaveLength(128);
  });

  it('keeps the outbox lease longer than a backend call, and the backoff ordered', () => {
    expect(
      failure(
        base({ OUTBOX_LEASE_SECONDS: '5', PAYMENT_BACKEND_TIMEOUT_MS: '5000' }),
      ).variables,
    ).toEqual(['OUTBOX_LEASE_SECONDS']);
    expect(
      failure(
        base({ OUTBOX_BASE_BACKOFF_MS: '5000', OUTBOX_MAX_BACKOFF_MS: '1000' }),
      ).variables,
    ).toEqual(['OUTBOX_MAX_BACKOFF_MS']);
  });

  it('needs https to the payment backend and the JWKS in production', () => {
    const production = (overrides: Record<string, string>) =>
      base({ NODE_ENV: 'production', ...overrides });
    expect(
      failure(production({ PAYMENT_BACKEND_URL: 'http://payments.internal' }))
        .variables,
    ).toEqual(['PAYMENT_BACKEND_URL']);
    expect(
      loadConfig(
        production({
          PAYMENT_BACKEND_URL: 'http://payments.internal',
          PAYMENT_BACKEND_ALLOW_HTTP: 'true',
        }),
      ).paymentBackend.url,
    ).toBe('http://payments.internal');
    expect(
      failure(production({ AUTH_JWKS_URL: 'http://jwks.example.test' }))
        .variables,
    ).toEqual(['AUTH_JWKS_URL']);
    expect(
      loadConfig(base({ PAYMENT_BACKEND_URL: 'http://localhost:3001' }))
        .paymentBackend.url,
    ).toBe('http://localhost:3001');
  });

  it('allows turning the background sender off (tests, one-off scripts)', () => {
    expect(
      loadConfig(base({ OUTBOX_POLL_INTERVAL_MS: '0' })).outbox.pollIntervalMs,
    ).toBe(0);
  });
});
