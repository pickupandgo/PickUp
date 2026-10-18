import {
  createEngineClient,
  EngineApiError,
  engineBaseUrl,
} from '../src/services/engine/engineClient';
import { PaymentsApiError } from '../src/services/payments/paymentsErrors';

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'driver-1' } }),
  getIdToken: jest.fn(async () => 'token'),
}));
jest.mock('../src/config/env', () => ({
  env: {
    API_BASE_URL: 'https://engine.example.in',
    IS_MOCK_MODE: false,
    REQUEST_TIMEOUT_MS: 5000,
  },
}));

const BASE = 'https://engine.example.in';

function response(status: number, body: unknown): Response {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => text,
  } as unknown as Response;
}

function setup(...answers: Array<Response | Error>) {
  const queue = [...answers];
  const fetchImpl = jest.fn(async () => {
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) {
      throw next;
    }
    return next as Response;
  });
  const getToken = jest.fn(async (force: boolean) =>
    force ? 'fresh-token' : 'cached-token',
  );
  const client = createEngineClient({
    baseUrl: BASE,
    getToken,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return { client, fetchImpl, getToken };
}

const headersOf = (fetchImpl: jest.Mock, call = 0) =>
  (fetchImpl.mock.calls[call] as [string, RequestInit])[1].headers as Record<
    string,
    string
  >;

describe('engine client: authentication', () => {
  it("sends the signed-in driver's Firebase token on every request", async () => {
    const { client, fetchImpl } = setup(response(200, { success: true }));
    await client.request({ method: 'POST', path: '/trips/x/arrive' });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/trips/x/arrive`,
      expect.objectContaining({ method: 'POST' }),
    );
    expect(headersOf(fetchImpl).Authorization).toBe('Bearer cached-token');
  });

  it('refreshes an expired token once, then gives up', async () => {
    const expired = response(401, {
      statusCode: 401,
      code: 'AUTH_INVALID_TOKEN',
      message: 'Invalid token',
    });
    const once = setup(expired, response(200, { success: true }));
    await expect(
      once.client.request({ method: 'GET', path: '/trips/x' }),
    ).resolves.toEqual({ success: true });
    expect(once.getToken.mock.calls).toEqual([[false], [true]]);
    expect(headersOf(once.fetchImpl, 1).Authorization).toBe(
      'Bearer fresh-token',
    );

    const always = setup(expired);
    await expect(
      always.client.request({ method: 'GET', path: '/trips/x' }),
    ).rejects.toMatchObject({ code: 'AUTH_INVALID_TOKEN', status: 401 });
    expect(always.fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends nothing when no driver is signed in', async () => {
    const fetchImpl = jest.fn();
    const client = createEngineClient({
      baseUrl: BASE,
      getToken: async () => {
        throw new PaymentsApiError('NOT_SIGNED_IN', 'Not signed in', 401);
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(
      client.request({ method: 'GET', path: '/trips/x' }),
    ).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('surfaces a refused identity as an error, never a success', async () => {
    const { client } = setup(
      response(403, {
        statusCode: 403,
        error: 'Forbidden',
        code: 'IDENTITY_MISMATCH',
        message: 'driverId must be the signed-in user',
      }),
    );
    await expect(
      client.request({ method: 'GET', path: '/trips/active/driver/other' }),
    ).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH', status: 403 });
  });
});

describe('engine client: failures are never successes', () => {
  it('reports a timeout as an unknown outcome after the retries', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new Error('aborted')),
            );
          }),
      );
      const client = createEngineClient({
        baseUrl: BASE,
        getToken: async () => 'token',
        fetchImpl: fetchImpl as unknown as typeof fetch,
        timeoutMs: 1_000,
        sleep: async () => undefined,
      });
      const outcome = client
        .request({ method: 'POST', path: '/trips/x/start' })
        .catch((error: unknown) => error);
      for (let i = 0; i < 3; i += 1) {
        await jest.advanceTimersByTimeAsync(1_000);
      }
      const error = (await outcome) as EngineApiError;
      expect(error).toBeInstanceOf(EngineApiError);
      expect(error.code).toBe('TIMEOUT');
      expect(error.outcomeUnknown).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a network failure (idempotent engine actions), then succeeds', async () => {
    const { client, fetchImpl } = setup(
      new TypeError('Network request failed'),
      response(200, { success: true, changed: false }),
    );
    await expect(
      client.request({ method: 'POST', path: '/trips/x/arrive' }),
    ).resolves.toEqual({ success: true, changed: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not retry polls, refusals or an unavailable payment backend', async () => {
    const poll = setup(new TypeError('Network request failed'));
    await expect(
      poll.client.request({
        method: 'GET',
        path: '/ride-requests/d',
        retry: false,
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    expect(poll.fetchImpl).toHaveBeenCalledTimes(1);

    const refused = setup(
      response(409, {
        statusCode: 409,
        code: 'PAYMENT_REQUIRED',
        message: 'Payment is required before the pickup handover',
        details: { stage: 'PICKUP', amountPaise: 50_000 },
      }),
    );
    await expect(
      refused.client.request({
        method: 'POST',
        path: '/trips/x/pickup/verify-otp',
      }),
    ).rejects.toMatchObject({
      code: 'PAYMENT_REQUIRED',
      status: 409,
      details: { stage: 'PICKUP', amountPaise: 50_000 },
    });
    expect(refused.fetchImpl).toHaveBeenCalledTimes(1);

    const unavailable = setup(
      response(503, {
        statusCode: 503,
        code: 'PAYMENT_BACKEND_UNAVAILABLE',
        message: 'nothing was changed',
      }),
    );
    await expect(
      unavailable.client.request({ method: 'POST', path: '/trips/x/start' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_BACKEND_UNAVAILABLE' });
    expect(unavailable.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the server message of a plain refusal', async () => {
    const { client } = setup(
      response(400, {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid OTP. Please ask the customer for the correct code.',
      }),
    );
    await expect(
      client.request({ method: 'POST', path: '/trips/x/pickup/verify-otp' }),
    ).rejects.toMatchObject({
      code: 'HTTP_400',
      message: 'Invalid OTP. Please ask the customer for the correct code.',
    });
  });

  it('never reads an unparsable success as one', async () => {
    const fetchImpl = jest.fn(async () => ({
      status: 200,
      ok: true,
      text: async () => '<html>proxy</html>',
    }));
    const client = createEngineClient({
      baseUrl: BASE,
      getToken: async () => 'token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => undefined,
    });
    await expect(
      client.request({ method: 'POST', path: '/trips/x/complete' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('only sends fixed paths', async () => {
    const { client, fetchImpl } = setup(response(200, {}));
    for (const path of ['trips/x', '/trips/../x', '/trips/x?y=1', '//evil']) {
      await expect(client.request({ method: 'GET', path })).rejects.toThrow(
        'Invalid engine API path',
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('engineBaseUrl', () => {
  it('accepts https engine URLs only (plain http only in development builds)', () => {
    expect(engineBaseUrl('https://engine.example.in/')).toBe(
      'https://engine.example.in',
    );
    expect(engineBaseUrl('https://engine.example.in:8443/api')).toBe(
      'https://engine.example.in:8443/api',
    );
    expect(engineBaseUrl(undefined)).toBeNull();
    expect(engineBaseUrl('ftp://engine.example.in')).toBeNull();
    expect(engineBaseUrl('https://user:pass@engine.example.in')).toBeNull();
    // Jest runs as a development build (__DEV__): a laptop engine over http is allowed.
    expect(engineBaseUrl('http://10.0.2.2:3000')).toBe('http://10.0.2.2:3000');
  });
});
