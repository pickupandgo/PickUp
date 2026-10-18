import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import { loadConfig } from '../config/engine-config';
import { PaymentBackendClient } from './payment-backend.client';
import { internalBookingSchema } from './payment-backend.types';

const KEY = 'engine_unit_test_internal_key_0123456789ab';

/** path -> [status, raw body] */
const answers = new Map<string, [number, string]>();
const seen: IncomingMessage[] = [];
let server: Server;
let client: PaymentBackendClient;

const envelope = (code: string, details?: object) =>
  JSON.stringify({ error: { code, message: `${code} message`, details } });

beforeAll(async () => {
  server = createServer((request, response) => {
    seen.push(request);
    request.resume();
    request.on('end', () => {
      if (request.url === '/slow') {
        setTimeout(() => response.end('{}'), 1_500).unref();
        return;
      }
      const [status, body] = answers.get(request.url ?? '') ?? [
        404,
        envelope('NOT_FOUND'),
      ];
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  client = new PaymentBackendClient(
    loadConfig({
      DATABASE_URL: 'postgresql://localhost:5432/engine',
      AUTH_ISSUER: 'issuer',
      AUTH_AUDIENCE: 'audience',
      PAYMENT_BACKEND_URL: `http://127.0.0.1:${port}/`,
      PAYMENT_BACKEND_INTERNAL_API_KEY: KEY,
      PAYMENT_BACKEND_TIMEOUT_MS: '500',
      OUTBOX_LEASE_SECONDS: '5',
    }),
  );
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  answers.clear();
  seen.length = 0;
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const call = (path: string) =>
  client.call({
    method: 'POST',
    path,
    body: { status: 'ARRIVED' },
    requestId: 'eng-unit-0001',
  });

describe('PaymentBackendClient', () => {
  it('sends the internal key, the request id and JSON, and reads a 2xx as OK', async () => {
    answers.set('/ok', [200, '{"done":true}']);
    await expect(call('/ok')).resolves.toEqual({
      kind: 'OK',
      status: 200,
      body: { done: true },
    });
    expect(seen[0]?.headers).toMatchObject({
      'x-internal-api-key': KEY,
      'x-request-id': 'eng-unit-0001',
      'content-type': 'application/json',
    });
  });

  it("reads a 4xx with the backend's envelope as a definitive refusal, with its code", async () => {
    answers.set('/refused', [
      409,
      envelope('PAYMENT_REQUIRED', { stage: 'DROP', stopSequence: 2 }),
    ]);
    await expect(call('/refused')).resolves.toEqual({
      kind: 'REFUSED',
      status: 409,
      code: 'PAYMENT_REQUIRED',
      message: 'PAYMENT_REQUIRED message',
      details: { stage: 'DROP', stopSequence: 2 },
    });
    answers.set('/bare', [422, 'not json at all']);
    await expect(call('/bare')).resolves.toMatchObject({
      kind: 'UNAVAILABLE',
      code: 'UNREADABLE_RESPONSE',
    });
    answers.set('/odd', [400, '{"message":"no envelope"}']);
    await expect(call('/odd')).resolves.toMatchObject({
      kind: 'REFUSED',
      code: 'HTTP_400',
      details: null,
    });
  });

  it.each([500, 502, 503, 504, 408, 425, 429])(
    'treats HTTP %i as no answer (retryable)',
    async (status) => {
      answers.set('/down', [status, envelope('SERVICE_UNAVAILABLE')]);
      await expect(call('/down')).resolves.toMatchObject({
        kind: 'UNAVAILABLE',
        status,
      });
    },
  );

  it('treats a refused internal key (401/403) as a configuration problem: retryable, alerted', async () => {
    const alert = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    for (const status of [401, 403]) {
      answers.set('/auth', [status, envelope('INTERNAL_AUTH_INVALID')]);
      await expect(call('/auth')).resolves.toMatchObject({
        kind: 'UNAVAILABLE',
        status,
      });
    }
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({ alert: 'PAYMENT_BACKEND_AUTH_FAILED' }),
    );
  });

  it('treats a timeout, a network error or an empty 2xx as no answer', async () => {
    await expect(call('/slow')).resolves.toMatchObject({
      kind: 'UNAVAILABLE',
      code: 'TIMEOUT',
      status: null,
    });
    answers.set('/empty', [200, '']);
    await expect(call('/empty')).resolves.toMatchObject({
      kind: 'UNAVAILABLE',
      code: 'UNREADABLE_RESPONSE',
    });
    const offline = new PaymentBackendClient(
      loadConfig({
        DATABASE_URL: 'postgresql://localhost:5432/engine',
        AUTH_ISSUER: 'issuer',
        AUTH_AUDIENCE: 'audience',
        PAYMENT_BACKEND_URL: 'http://127.0.0.1:1',
        PAYMENT_BACKEND_INTERNAL_API_KEY: KEY,
      }),
    );
    await expect(
      offline.call({ method: 'GET', path: '/x', requestId: 'eng-unit-0002' }),
    ).resolves.toMatchObject({ kind: 'UNAVAILABLE', code: 'NETWORK_ERROR' });
  });

  it('applies nothing from an answer of an unexpected shape (contract mismatch alert)', () => {
    const alert = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const outcome = client.parse(
      internalBookingSchema,
      { kind: 'OK', status: 200, body: { bookingId: 'x' } },
      '/p',
    );
    expect(outcome).toMatchObject({
      kind: 'UNAVAILABLE',
      code: 'UNEXPECTED_RESPONSE',
    });
    expect(alert).toHaveBeenCalledWith(
      expect.objectContaining({ alert: 'PAYMENT_BACKEND_CONTRACT_MISMATCH' }),
    );
  });
});
