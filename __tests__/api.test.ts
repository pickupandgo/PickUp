jest.mock('../src/config/env', () => ({
  env: { API_BASE_URL: 'https://api.pickup.dev', REQUEST_TIMEOUT_MS: 5000 }
}));
import { ApiClient } from '../src/services/api/ApiClient';
import { ApiError } from '../src/services/api/ApiError';

describe('ApiClient', () => {
  let client: ApiClient;

  beforeEach(() => {
    // @ts-ignore
    ApiClient.instance = undefined; // Reset singleton
    client = ApiClient.getInstance();
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('performs a successful GET request', async () => {
    const mockResponse = { data: 'success' };
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true, headers: { get: () => 'application/json' },
      json: async () => mockResponse,
    });

    const result = await client.get('/test');
    expect(result).toEqual(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.pickup.dev/test',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('throws ApiError on HTTP failure', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404, headers: { get: () => 'application/json' },
      json: async () => ({ message: 'Not found' }),
    });

    try { await client.get('/test'); } catch (e: any) { expect(e).toBeInstanceOf(ApiError); expect(e.statusCode).toBe(404); }
  });

  it('retries on network failure if retryable', async () => {
    (globalThis.fetch as jest.Mock)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true }),
      });

    const result = await client.get('/retry-test', { retryable: true });
    expect(result).toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries once with fresh token on HTTP 401 response', async () => {
    const mockTokenProvider = jest.fn().mockResolvedValue('refreshed-firebase-token');
    client.setTokenProvider(mockTokenProvider);
    client.setToken('initial-expired-token');

    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Unauthorized / token expired' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ profile: 'authorized_driver' }),
      });

    const result = await client.get('/v1/drivers/me');
    expect(result).toEqual({ profile: 'authorized_driver' });
    expect(mockTokenProvider).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    const secondCall = (globalThis.fetch as jest.Mock).mock.calls[1];
    expect(secondCall[1].headers.get('Authorization')).toBe('Bearer refreshed-firebase-token');
  });

  it('does not retry infinitely if 401 persists after token refresh', async () => {
    const mockTokenProvider = jest.fn().mockResolvedValue('fresh-token-still-rejected');
    client.setTokenProvider(mockTokenProvider);
    client.setToken('bad-token');

    (globalThis.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ message: 'Still Unauthorized' }),
      });

    await expect(client.get('/v1/drivers/me')).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(mockTokenProvider).toHaveBeenCalledTimes(1);
  });
});