jest.mock('../src/config/env', () => ({
  env: {
    apiBaseUrl: 'https://engine.test',
    engineApiBaseUrl: 'https://engine.test',
    paymentsApiBaseUrl: 'https://backend.test',
    googleMapsApiKey: 'test-key',
  },
  assertApiConfig: () => {},
  hasPaymentsConfig: () => true,
  hasGeocodingConfig: () => true,
}));
const mockToken = jest.fn();
let mockUser: any;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockUser }),
}));
import { request } from '../src/api/http';
import { paymentsRequest } from '../src/api/payments';
import Geolocation from '@react-native-community/geolocation';
import {
  getCurrentPlace,
  searchPlaces,
  reverseGeocode,
} from '../src/api/geocoding';
const ok = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});
beforeEach(() => {
  jest.useFakeTimers();
  mockToken.mockReset().mockResolvedValue('token-A');
  mockUser = { uid: 'A', getIdToken: mockToken };
  globalThis.fetch = jest.fn(async () => ok({ success: true })) as any;
});
afterEach(() => {
  jest.useRealTimers();
});
it('settles a stalled engine body within one complete deadline', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: () => new Promise(() => {}),
  });
  const pending = expect(
    request('/rides', { timeoutMs: 500 }),
  ).rejects.toMatchObject({ kind: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('times out token acquisition and never sends the late engine request', async () => {
  let finish!: (value: string) => void;
  mockToken.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = expect(
    request('/rides', { timeoutMs: 500 }),
  ).rejects.toMatchObject({ kind: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await pending;
  finish('late-token-A');
  await Promise.resolve();
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});
it('does not turn a failed token lookup into an anonymous mutation', async () => {
  mockToken.mockRejectedValueOnce(new Error('token failed'));
  await expect(request('/rides', { method: 'POST' })).rejects.toMatchObject({
    kind: 'network',
  });
  expect(fetch).not.toHaveBeenCalled();
});
it('never automatically retries unsafe engine mutations on 5xx', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 503,
    text: async () => '{}',
  });
  await expect(
    request('/rides', { method: 'POST', retries: 3 }),
  ).rejects.toMatchObject({ status: 503 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('bounds retries and backoff within the same total deadline', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce({ ok: false, status: 503, text: async () => '{}' })
    .mockImplementationOnce(() => new Promise(() => {}));
  const pending = expect(
    request('/rides', { timeoutMs: 500 }),
  ).rejects.toMatchObject({ kind: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('pre-aborted engine, backend and address operations do not contact providers', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    request('/rides', { signal: controller.signal }),
  ).rejects.toMatchObject({ kind: 'network' });
  await expect(
    paymentsRequest('/v1/customers/me', { signal: controller.signal }),
  ).rejects.toMatchObject({ kind: 'network' });
  await expect(
    searchPlaces('Jodhpur', { signal: controller.signal }),
  ).rejects.toMatchObject({ kind: 'network' });
  expect(fetch).not.toHaveBeenCalled();
  expect(mockToken).not.toHaveBeenCalled();
});
it('cancels retry backoff without a later request', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 503,
    text: async () => '{}',
  });
  const controller = new AbortController();
  const pending = expect(
    request('/rides', { signal: controller.signal }),
  ).rejects.toMatchObject({ kind: 'network' });
  await jest.advanceTimersByTimeAsync(1);
  controller.abort();
  await pending;
  await jest.advanceTimersByTimeAsync(1000);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects an A-to-B switch during token acquisition for both transports', async () => {
  for (const client of [
    () => request('/rides'),
    () => paymentsRequest('/v1/customers/me'),
  ]) {
    let finish!: (value: string) => void;
    mockUser = { uid: 'A', getIdToken: mockToken };
    mockToken.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = expect(client()).rejects.toMatchObject({
      kind: 'session_changed',
    });
    await jest.advanceTimersByTimeAsync(0);
    mockUser = { uid: 'B', getIdToken: mockToken };
    finish('token-A');
    await pending;
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('bounds backend auto-provisioning recovery and never retries the original mutation after cancellation', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () =>
        JSON.stringify({ error: { code: 'USER_NOT_PROVISIONED' } }),
    })
    .mockResolvedValueOnce({ ok: true, text: () => new Promise(() => {}) });
  const pending = expect(
    paymentsRequest('/v1/example', {
      method: 'PATCH',
      body: { name: 'A' },
      timeoutMs: 500,
    }),
  ).rejects.toMatchObject({ kind: 'timeout' });
  await jest.advanceTimersByTimeAsync(500);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(2);
  expect((fetch as jest.Mock).mock.calls[1][1].signal.aborted).toBe(true);
});
it('bounds address provider body stalls and does not launch a late fallback', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: () => new Promise(() => {}),
  });
  const pending = expect(searchPlaces('Jodhpur')).rejects.toMatchObject({
    kind: 'timeout',
  });
  await jest.advanceTimersByTimeAsync(12000);
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('cancels reverse-geocoding without reporting fabricated address success', async () => {
  (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = expect(
    reverseGeocode({ latitude: 26.2, longitude: 73 }, controller.signal),
  ).rejects.toMatchObject({ kind: 'network' });
  await jest.advanceTimersByTimeAsync(0);
  controller.abort();
  await pending;
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('cancels a GPS waiter promptly while allowing the shared native callback to retire safely', async () => {
  let finish!: (position: any) => void;
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementationOnce(
    (success) => {
      finish = success;
    },
  );
  const controller = new AbortController();
  const pending = expect(
    getCurrentPlace(controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await jest.advanceTimersByTimeAsync(0);
  controller.abort();
  await pending;
  finish({ coords: { latitude: 26.2, longitude: 73 } });
  await jest.advanceTimersByTimeAsync(0);
  expect(fetch).not.toHaveBeenCalled();
});
it('bounds native GPS callbacks even when the location provider never replies', async () => {
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementationOnce(
    () => {},
  );
  const pending = expect(getCurrentPlace()).rejects.toMatchObject({
    kind: 'location_timeout',
  });
  await jest.advanceTimersByTimeAsync(22000);
  await pending;
  expect(fetch).not.toHaveBeenCalled();
});
it('does not convert cancellation during address lookup into a successful coordinate fallback', async () => {
  (Geolocation.getCurrentPosition as jest.Mock).mockImplementationOnce(
    (success) => success({ coords: { latitude: 26.2, longitude: 73 } }),
  );
  (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = expect(
    getCurrentPlace(controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
  await jest.advanceTimersByTimeAsync(0);
  controller.abort();
  await pending;
});
