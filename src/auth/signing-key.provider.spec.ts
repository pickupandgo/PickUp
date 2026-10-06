import { generateKeyPairSync } from 'node:crypto';
import type { AppConfig } from '../config/app-config';
import { cacheLifetimeSeconds, RemoteJwksKeyProvider } from './signing-key.provider';

function jwk(kid: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const exported = publicKey.export({ format: 'jwk' });
  return { kty: 'RSA', n: exported.n, e: exported.e, kid, alg: 'RS256', use: 'sig', ...extra };
}

function jsonResponse(body: unknown, cacheControl = 'public, max-age=3600'): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': cacheControl },
  });
}

describe('RemoteJwksKeyProvider', () => {
  const config = { auth: { jwksUrl: 'https://keys.example.test/jwks' } } as unknown as AppConfig;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-02T00:00:00Z') });
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
    jest.useRealTimers();
  });

  it('fetches keys once and serves them from cache', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ keys: [jwk('a'), jwk('b')] }));
    const provider = new RemoteJwksKeyProvider(config);

    await expect(provider.getKey('a')).resolves.toBeDefined();
    await expect(provider.getKey('b')).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://keys.example.test/jwks');
  });

  it('refetches after max-age expires', async () => {
    const key = jwk('a');
    fetchMock.mockImplementation(() =>
      Promise.resolve(jsonResponse({ keys: [key] }, 'max-age=120')),
    );
    const provider = new RemoteJwksKeyProvider(config);
    await provider.getKey('a');

    jest.advanceTimersByTime(121_000);
    await expect(provider.getKey('a')).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refetches once for an unknown kid, then waits out the cooldown', async () => {
    const key = jwk('a');
    fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ keys: [key] })));
    const provider = new RemoteJwksKeyProvider(config);
    await provider.getKey('a');

    jest.advanceTimersByTime(31_000);
    await expect(provider.getKey('rotated')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Random kids cannot force more requests inside the cooldown window.
    await provider.getKey('random-1');
    await provider.getKey('random-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignores keys that are not RSA RS256 signing keys', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ keys: [jwk('enc', { use: 'enc' }), jwk('hs', { alg: 'HS256' }), jwk('ok')] }),
    );
    const provider = new RemoteJwksKeyProvider(config);
    await expect(provider.getKey('enc')).resolves.toBeUndefined();
    await expect(provider.getKey('hs')).resolves.toBeUndefined();
    await expect(provider.getKey('ok')).resolves.toBeDefined();
  });

  it('fails with 503 when keys cannot be fetched and none are cached', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    const provider = new RemoteJwksKeyProvider(config);
    await expect(provider.getKey('a')).rejects.toMatchObject({
      code: 'AUTH_PROVIDER_UNAVAILABLE',
      status: 503,
    });
  });

  it('keeps using cached keys when a refresh fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ keys: [jwk('a')] }, 'max-age=60'));
    const provider = new RemoteJwksKeyProvider(config);
    await provider.getKey('a');

    fetchMock.mockRejectedValue(new TypeError('network down'));
    jest.advanceTimersByTime(61_000);
    await expect(provider.getKey('a')).resolves.toBeDefined();
  });

  it('rejects an HTTP error response', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    const provider = new RemoteJwksKeyProvider(config);
    await expect(provider.getKey('a')).rejects.toMatchObject({ code: 'AUTH_PROVIDER_UNAVAILABLE' });
  });
});

describe('cacheLifetimeSeconds', () => {
  it.each([
    ['public, max-age=19890, must-revalidate', 19_890],
    ['max-age=5', 60],
    ['max-age=999999', 86_400],
    [null, 3_600],
    ['no-cache', 3_600],
  ])('%p -> %p seconds', (header, expected) => {
    expect(cacheLifetimeSeconds(header)).toBe(expected);
  });
});
