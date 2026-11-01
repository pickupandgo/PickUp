jest.mock('../src/config/env', () => ({
  env: { engineApiBaseUrl: 'https://engine.test', apiBaseUrl: 'https://engine.test', paymentsApiBaseUrl: 'https://pay.test' },
  hasPaymentsConfig: () => true,
  assertApiConfig: () => undefined,
}));

const mockGetIdToken = jest.fn(async (_refresh?: boolean) => 'customer-token');
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { getIdToken: mockGetIdToken } }),
}));

import { fetchUserProfileApi, saveUserProfileApi } from '../src/api/userProfile';
import { request } from '../src/api/http';

const account = {
  customerId: 'customer-1', phone: '+919876543210', status: 'ACTIVE',
  createdAt: '2026-10-30T00:00:00.000Z', name: 'Riya', email: 'riya@example.com',
};

beforeEach(() => {
  mockGetIdToken.mockClear();
});

it('reads and registers customer profile on backend origin while engine requests remain on engine', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(account) } as Response;
  }) as unknown as typeof fetch;

  expect((await fetchUserProfileApi())?.uid).toBe('customer-1');
  await saveUserProfileApi({ fullName: 'Riya', email: 'riya@example.com', age: '29', address: 'Jaipur' });
  await request('/rides', { retries: 0 });

  expect(calls.map(({ url, init }) => [url, init.method])).toEqual([
    ['https://pay.test/v1/customers/me', 'GET'],
    ['https://pay.test/v1/customers/me', 'PATCH'],
    ['https://engine.test/rides', 'GET'],
  ]);
  for (const { init } of calls) {
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer customer-token');
  }
});
