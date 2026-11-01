jest.mock('../src/config/env', () => ({
  env: { paymentsApiBaseUrl: 'https://backend.test', googleMapsApiKey: '' },
  hasPaymentsConfig: () => true,
}));
const mockToken = jest.fn(async () => 'customer-test-token');
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { getIdToken: mockToken } }),
}));
import { getRoute } from '../src/api/directions';
const a = { latitude: 26.2389, longitude: 73.0243, address: 'Private address' };
const b = { latitude: 26.21, longitude: 73.02 };
const c = { latitude: 26.2, longitude: 73.01 };
const valid = {
  encodedPolyline: 'oashCsvmuMnAf@',
  distanceMeters: 2400,
  durationSeconds: 123,
};
beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(valid),
  })) as any;
});
it('uses only authenticated backend routing without an Android Maps key', async () => {
  const result = await getRoute(a, c, { waypoints: [b] });
  const [url, init] = (fetch as jest.Mock).mock.calls[0];
  expect(url).toBe('https://backend.test/v1/routes/road');
  expect(init.headers.Authorization).toBe('Bearer customer-test-token');
  expect(init.headers['X-Goog-Api-Key']).toBeUndefined();
  expect(JSON.parse(init.body)).toEqual({
    origin: { latitude: a.latitude, longitude: a.longitude },
    destination: c,
    waypoints: [b],
  });
  expect(init.body).not.toContain('Private address');
  expect(result.distanceMeters).toBe(2400);
  expect(result.polyline.length).toBeGreaterThan(1);
});
it('propagates a truthful server configuration error without direct Google fallback', async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: false,
    status: 503,
    text: async () =>
      JSON.stringify({
        error: {
          code: 'ROUTING_PROVIDER_DENIED',
          message: 'Road routing is unavailable.',
        },
      }),
  });
  await expect(getRoute(a, b)).rejects.toMatchObject({
    status: 503,
    kind: 'http',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('rejects malformed/truncated geometry and invalid numeric responses', async () => {
  for (const body of [
    { ...valid, encodedPolyline: '~' },
    { ...valid, durationSeconds: -1 },
    { ...valid, distanceMeters: '2400' },
    { ...valid, encodedPolyline: '?' },
  ]) {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify(body),
    });
    await expect(getRoute(a, b)).rejects.toMatchObject({ kind: 'parse' });
  }
});
it('does not send invalid coordinates', async () => {
  await expect(
    getRoute({ latitude: 91, longitude: 73 }, b),
  ).rejects.toMatchObject({ kind: 'config' });
  expect(fetch).not.toHaveBeenCalled();
});
it('honors caller cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    getRoute(a, b, { signal: controller.signal }),
  ).rejects.toMatchObject({ kind: 'network' });
  expect(fetch).not.toHaveBeenCalled();
});
it('bounds the complete authenticated request including a stalled response body', async () => {
  jest.useFakeTimers();
  try {
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => new Promise(() => {}),
    });
    const pending = expect(getRoute(a, b)).rejects.toMatchObject({
      kind: 'timeout',
    });
    await jest.advanceTimersByTimeAsync(12000);
    await pending;
  } finally {
    jest.useRealTimers();
  }
});
