describe('env configuration tests', () => {
  const originalDev = (globalThis as any).__DEV__;

  afterEach(() => {
    (globalThis as any).__DEV__ = originalDev;
    jest.resetModules();
  });

  it('correctly accepts and normalizes https URL with /v1 in production', () => {
    (globalThis as any).__DEV__ = false;
    jest.doMock('react-native-config', () => ({
      EXPO_PUBLIC_PAYMENTS_API_BASE_URL: 'https://pickup-backend-engine-v2.onrender.com/v1',
      EXPO_PUBLIC_API_BASE_URL: 'https://pickup-backend-engine-v2.onrender.com',
      EXPO_PUBLIC_GOOGLE_MAPS_API_KEY: 'test-key',
    }));

    const { env, hasPaymentsConfig } = require('../src/config/env');
    expect(hasPaymentsConfig()).toBe(true);
    expect(env.paymentsApiBaseUrl).toBe('https://pickup-backend-engine-v2.onrender.com');
  });

  it('correctly accepts https URL without /v1 and with trailing slashes', () => {
    (globalThis as any).__DEV__ = false;
    jest.doMock('react-native-config', () => ({
      EXPO_PUBLIC_PAYMENTS_API_BASE_URL: 'https://pickup-backend-engine-v2.onrender.com/v1/',
      EXPO_PUBLIC_API_BASE_URL: 'https://pickup-backend-engine-v2.onrender.com',
    }));

    const { env, hasPaymentsConfig } = require('../src/config/env');
    expect(hasPaymentsConfig()).toBe(true);
    expect(env.paymentsApiBaseUrl).toBe('https://pickup-backend-engine-v2.onrender.com');
  });

  it('allows http in development mode', () => {
    (globalThis as any).__DEV__ = true;
    jest.doMock('react-native-config', () => ({
      EXPO_PUBLIC_PAYMENTS_API_BASE_URL: 'http://localhost:3000/v1',
    }));

    const { env, hasPaymentsConfig } = require('../src/config/env');
    expect(hasPaymentsConfig()).toBe(true);
    expect(env.paymentsApiBaseUrl).toBe('http://localhost:3000');
  });

  it('drops unencrypted http in production mode', () => {
    (globalThis as any).__DEV__ = false;
    jest.doMock('react-native-config', () => ({
      EXPO_PUBLIC_PAYMENTS_API_BASE_URL: 'http://localhost:3000/v1',
    }));

    const { env, hasPaymentsConfig } = require('../src/config/env');
    expect(hasPaymentsConfig()).toBe(false);
    expect(env.paymentsApiBaseUrl).toBe('');
  });

  it('handles missing or empty payments base URL', () => {
    (globalThis as any).__DEV__ = false;
    jest.doMock('react-native-config', () => ({}));

    const { env, hasPaymentsConfig } = require('../src/config/env');
    expect(hasPaymentsConfig()).toBe(false);
    expect(env.paymentsApiBaseUrl).toBe('');
  });
});
