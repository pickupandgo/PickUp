import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import type { AppConfig } from '../config/app-config';
import { ACCESS_POLICY_KEY } from '../auth/decorators';
import { RoutingService } from './routing.service';
import { RoutingController } from './routing.controller';
import { RoadRouteRequest } from './routing.dto';
const input = {
  origin: { latitude: 26.2, longitude: 73 },
  destination: { latitude: 26.3, longitude: 73.1 },
  waypoints: [{ latitude: 26.25, longitude: 73.05 }],
};
const response = {
  routes: [
    { distanceMeters: 4200, duration: '420.5s', polyline: { encodedPolyline: 'oashCsvmuMnAf@' } },
  ],
};
const cfg = { googleRoutes: { apiKey: 'server-test-key' } } as AppConfig;
const fetchMock = jest.fn();
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(response) });
});
it('requires the existing registered customer policy', () => {
  expect(Reflect.getMetadata(ACCESS_POLICY_KEY, RoutingController)).toBe('CUSTOMER');
});
it('rejects missing/invalid coordinates, too many stops and injected provider options', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const body of [
    { destination: input.destination },
    { ...input, origin: { latitude: 91, longitude: 73 } },
    { ...input, waypoints: Array(25).fill(input.origin) },
    { ...input, providerUrl: 'https://example.invalid' },
  ]) {
    await expect(
      pipe.transform(body, { type: 'body', metatype: RoadRouteRequest }),
    ).rejects.toBeDefined();
  }
});
it('keeps provider credentials server-only and preserves stop order', async () => {
  const result = await new RoutingService(cfg).route(input);
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
  expect(request.headers['X-Goog-Api-Key']).toBe('server-test-key');
  const body = JSON.parse(request.body);
  expect(body.intermediates[0].location.latLng).toEqual(input.waypoints[0]);
  expect(body.polylineQuality).toBe('HIGH_QUALITY');
  expect(result).toEqual({
    encodedPolyline: 'oashCsvmuMnAf@',
    distanceMeters: 4200,
    durationSeconds: 420.5,
  });
  expect(JSON.stringify(result)).not.toContain('server-test-key');
});
it('does not contact Google when the server key is missing', async () => {
  await expect(new RoutingService({} as AppConfig).route(input)).rejects.toMatchObject({
    code: 'ROUTING_NOT_CONFIGURED',
    status: 503,
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it('sanitizes upstream denial and retries rather than caching failures', async () => {
  const service = new RoutingService(cfg);
  fetchMock.mockResolvedValueOnce({
    ok: false,
    status: 403,
    json: () => Promise.resolve({ error: { message: 'private-project-secret' } }),
  });
  await expect(service.route(input)).rejects.toMatchObject({
    code: 'ROUTING_PROVIDER_DENIED',
    status: 503,
    message: 'Road routing is unavailable. Please try again later.',
  });
  await expect(service.route(input)).resolves.toHaveProperty('distanceMeters', 4200);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('coalesces concurrent routes without retaining location/result history', async () => {
  const service = new RoutingService(cfg);
  const [a, b] = await Promise.all([service.route(input), service.route(input)]);
  expect(a).toEqual(b);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await service.route(input);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it('rejects no route and malformed provider results', async () => {
  for (const payload of [
    {},
    { routes: [] },
    { routes: [{ distanceMeters: -1, duration: 'x', polyline: { encodedPolyline: 'bad' } }] },
  ]) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });
    await expect(new RoutingService(cfg).route(input)).rejects.toMatchObject({
      status: expect.any(Number),
    });
  }
});
it('bounds stalled body decoding and cancels the upstream request', async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => new Promise(() => {}) });
    const result = new RoutingService(cfg).route(input);
    const expected = expect(result).rejects.toMatchObject({ code: 'ROUTING_TIMEOUT', status: 504 });
    await jest.advanceTimersByTimeAsync(8000);
    await expected;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
it('caps concurrent distinct upstream requests', async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const service = new RoutingService(cfg);
    const results = Array.from({ length: 8 }, (_, i) =>
      service
        .route({ ...input, destination: { latitude: 26 + i / 100, longitude: 73 } })
        .catch((error) => error),
    );
    await expect(
      service.route({ ...input, destination: { latitude: 27, longitude: 73 } }),
    ).rejects.toMatchObject({ code: 'ROUTING_BUSY' });
    await jest.advanceTimersByTimeAsync(8000);
    await Promise.all(results);
  } finally {
    jest.useRealTimers();
  }
});
