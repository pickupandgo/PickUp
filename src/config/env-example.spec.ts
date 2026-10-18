import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { envSchema, loadConfig } from './engine-config';

/** .env.example documents every setting and is a valid configuration once its blanks are filled. */
describe('.env.example', () => {
  const example = parseEnv(
    readFileSync(path.join(__dirname, '..', '..', '.env.example'), 'utf8'),
  );

  it('lists every setting the engine reads', () => {
    expect(Object.keys(example).sort()).toEqual(
      Object.keys(envSchema.shape).sort(),
    );
  });

  it('holds no secret: the internal key is left blank', () => {
    expect(example['PAYMENT_BACKEND_INTERNAL_API_KEY']).toBe('');
  });

  it('loads once the internal key is set', () => {
    const config = loadConfig({
      ...example,
      PAYMENT_BACKEND_INTERNAL_API_KEY: 'a'.repeat(64),
    });
    expect(config).toMatchObject({
      nodeEnv: 'development',
      paymentBackend: { url: 'http://localhost:3000', timeoutMs: 5_000 },
      outbox: { pollIntervalMs: 1_000, leaseSeconds: 30 },
      dispatch: { offerTtlSeconds: 15 },
    });
  });
});
