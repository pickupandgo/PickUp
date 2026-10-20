import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { SigningKeyProvider } from './signing-key.provider';
import { TokenVerifier } from './token-verifier.service';

class MapKeyProvider extends SigningKeyProvider {
  constructor(private readonly keys: Map<string, KeyObject>) {
    super();
  }
  getKey(kid: string): Promise<KeyObject | undefined> {
    return Promise.resolve(this.keys.get(kid));
  }
}

const PROJECT = 'unit-test-project';
const ISSUER = `https://securetoken.google.com/${PROJECT}`;
const KID = 'unit-kid';

describe('TokenVerifier', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const config = { auth: { issuer: ISSUER, audience: PROJECT } } as unknown as AppConfig;
  const verifier = new TokenVerifier(config, new MapKeyProvider(new Map([[KID, publicKey]])));

  function sign(
    claims: Record<string, unknown> = {},
    options: {
      key?: KeyObject;
      kid?: string;
      issuer?: string;
      audience?: string;
      subject?: string;
    } = {},
  ): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      { iat: now, exp: now + 3600, auth_time: now, phone_number: '+910000000000', ...claims },
      options.key ?? privateKey,
      {
        algorithm: 'RS256',
        keyid: options.kid ?? KID,
        issuer: options.issuer ?? ISSUER,
        audience: options.audience ?? PROJECT,
        ...(options.subject === '' ? {} : { subject: options.subject ?? 'firebase-uid-123' }),
      },
    );
  }

  async function expectInvalid(token: string): Promise<void> {
    await expect(verifier.verify(token)).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
      status: 401,
    });
  }

  it('accepts a valid token and returns the subject', async () => {
    const authTime = Math.floor(Date.now() / 1000) - 120;
    await expect(
      verifier.verify(sign({ auth_time: authTime, firebase: { sign_in_provider: 'phone' } })),
    ).resolves.toEqual({
      subject: 'firebase-uid-123',
      phoneNumber: '+910000000000',
      authTime,
      signInProvider: 'phone',
    });
  });

  it('reports missing or malformed step-up claims as null instead of trusting them', async () => {
    await expect(
      verifier.verify(sign({ auth_time: undefined, phone_number: undefined })),
    ).resolves.toMatchObject({ authTime: null, phoneNumber: null, signInProvider: null });
    await expect(
      verifier.verify(sign({ firebase: 'phone', phone_number: '+91'.padEnd(30, '9') })),
    ).resolves.toMatchObject({ signInProvider: null, phoneNumber: null });
    await expect(
      verifier.verify(sign({ firebase: { sign_in_provider: 'custom' } })),
    ).resolves.toMatchObject({ signInProvider: 'custom' });
  });

  it('rejects a non-numeric auth_time', async () => {
    await expectInvalid(sign({ auth_time: 'yesterday' }));
  });

  it('rejects a token for another Firebase project', async () => {
    await expectInvalid(sign({}, { audience: 'someone-elses-project' }));
  });

  it('rejects a token from another issuer', async () => {
    await expectInvalid(sign({}, { issuer: 'https://evil.example.com' }));
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectInvalid(sign({ iat: now - 7200, exp: now - 3600 }));
  });

  it('rejects a token issued in the future', async () => {
    const now = Math.floor(Date.now() / 1000);
    await expectInvalid(sign({ iat: now + 600, exp: now + 4200 }));
  });

  it('rejects an auth_time in the future', async () => {
    await expectInvalid(sign({ auth_time: Math.floor(Date.now() / 1000) + 600 }));
  });

  it('rejects a token without a subject', async () => {
    await expectInvalid(sign({}, { subject: '' }));
  });

  it('rejects a token signed by a different key under a known kid', async () => {
    await expectInvalid(sign({}, { key: other.privateKey }));
  });

  it('rejects an unknown kid', async () => {
    await expectInvalid(sign({}, { kid: 'unknown-kid' }));
  });

  it('rejects HS256 tokens (algorithm confusion)', async () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({ iat: now, exp: now + 3600 }, pem, {
      algorithm: 'HS256',
      keyid: KID,
      issuer: ISSUER,
      audience: PROJECT,
      subject: 'attacker',
    });
    await expectInvalid(token);
  });

  it('rejects unsigned tokens (alg none)', async () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const token = `${encode({ alg: 'none', kid: KID })}.${encode({
      iss: ISSUER,
      aud: PROJECT,
      sub: 'attacker',
      iat: now,
      exp: now + 3600,
    })}.`;
    await expectInvalid(token);
  });

  it('rejects garbage and oversized input', async () => {
    await expectInvalid('not.a.token');
    await expectInvalid(`${sign()}${'a'.repeat(5000)}`);
  });

  it('only ever throws AppError', async () => {
    await expect(verifier.verify('###')).rejects.toBeInstanceOf(AppError);
  });
});
