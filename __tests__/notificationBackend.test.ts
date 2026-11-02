import { createNotificationBackend } from '../src/services/notifications/NotificationBackend';
jest.mock('../src/config/env', () => ({ env: { PAYMENTS_API_BASE_URL: 'https://backend.example', REQUEST_TIMEOUT_MS: 15000 } }));
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const response = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body } as Response);
test('registers the authenticated driver using the existing token DTO, without client recipient id', async () => {
  const fetchMock = jest.fn(async () => response(200, { token: 'fcm', role: 'DRIVER', userId: 'server-user' })); globalThis.fetch = fetchMock;
  const backend = createNotificationBackend({ uid: 'firebase-user', getIdToken: async () => 'firebase-bearer' }, () => true);
  expect(await backend.register('fcm', 'hi')).toMatchObject({ userId: 'server-user' });
  expect(fetchMock).toHaveBeenCalledWith('https://backend.example/v1/notifications/tokens', expect.objectContaining({
    method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer firebase-bearer' }),
    body: JSON.stringify({ token: 'fcm', role: 'DRIVER', platform: 'ANDROID', language: 'hi' }),
  }));
});
test('refreshes expired Firebase credential once and uses DELETE token contract on logout', async () => {
  globalThis.fetch = jest.fn().mockResolvedValueOnce(response(401, {})).mockResolvedValueOnce(response(200, { success: true }));
  const token = jest.fn(async () => 'bearer'); const backend = createNotificationBackend({ uid: 'a', getIdToken: token }, () => true);
  await backend.unregister('fcm'); expect(token.mock.calls).toEqual([[false], [true]]);
  expect(globalThis.fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ token: 'fcm' }) }));
});
test('rejects stale account requests and malformed registration acknowledgements', async () => {
  globalThis.fetch = jest.fn(async () => response(200, { token: 'other', role: 'DRIVER' }));
  const identity = { uid: 'a', getIdToken: async () => 'bearer' };
  await expect(createNotificationBackend(identity, () => false).register('fcm', 'en')).rejects.toThrow(/session changed/);
  expect(globalThis.fetch).not.toHaveBeenCalled();
  await expect(createNotificationBackend(identity, () => true).register('fcm', 'en')).rejects.toThrow(/invalid response/);
});
