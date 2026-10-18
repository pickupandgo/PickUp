import { createHmac, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../config/engine-config';
import { SigningKeyProvider } from './signing-key.provider';
import { TokenVerifier } from './token-verifier.service';

const PROJECT = 'multipleride-unit';
const ISSUER = `https://securetoken.google.com/${PROJECT}`;
const KID = 'unit-key';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

class Keys extends SigningKeyProvider {
  getKey(kid: string): Promise<KeyObject | undefined> {
    return Promise.resolve(kid === KID ? publicKey : undefined);
  }
}

const config = loadConfig({
  DATABASE_URL: 'postgresql://localhost:5432/engine',
  AUTH_ISSUER: ISSUER,
  AUTH_AUDIENCE: PROJECT,
  PAYMENT_BACKEND_URL: 'http://localhost:3001',
  PAYMENT_BACKEND_INTERNAL_API_KEY:
    'engine_unit_test_internal_key_0123456789ab',
});

const verifier = new TokenVerifier(config, new Keys());
const now = () => Math.floor(Date.now() / 1000);

function sign(
  claims: Record<string, unknown> = {},
  options: jwt.SignOptions = {},
  key: jwt.Secret = privateKey,
): string {
  return jwt.sign(
    {
      iat: now(),
      exp: now() + 3600,
      auth_time: now(),
      sub: 'firebase-uid-1',
      ...claims,
    },
    key,
    {
      algorithm: 'RS256',
      keyid: KID,
      issuer: ISSUER,
      audience: PROJECT,
      ...options,
    },
  );
}

async function rejects(token: string): Promise<void> {
  const error = await verifier.verify(token).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(HttpException);
  expect((error as HttpException).getStatus()).toBe(401);
  expect((error as HttpException).getResponse()).toMatchObject({
    code: 'AUTH_INVALID_TOKEN',
  });
}

describe('TokenVerifier (Firebase ID tokens)', () => {
  it('returns the subject of a valid token', async () => {
    await expect(verifier.verify(sign())).resolves.toEqual({
      subject: 'firebase-uid-1',
    });
  });

  it('refuses another algorithm, including HS256 signed with the public key', async () => {
    const claims = {
      sub: 'firebase-uid-1',
      iss: ISSUER,
      aud: PROJECT,
      iat: now(),
      exp: now() + 60,
    };
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    // Classic algorithm confusion: HMAC keyed with the published RSA public key.
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const unsignedPart = `${encode({ alg: 'HS256', typ: 'JWT', kid: KID })}.${encode(claims)}`;
    const mac = createHmac('sha256', pem)
      .update(unsignedPart)
      .digest('base64url');
    await rejects(`${unsignedPart}.${mac}`);
    await rejects(`${encode({ alg: 'none', kid: KID })}.${encode(claims)}.`);
  });

  it('refuses a missing or unknown key id, and a signature from another key', async () => {
    const other = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    }).privateKey;
    await rejects(
      jwt.sign({ sub: 'x', iat: now(), exp: now() + 60 }, privateKey, {
        algorithm: 'RS256',
      }),
    );
    await rejects(sign({}, { keyid: 'rotated-away' }));
    await rejects(sign({}, {}, other));
  });

  it('refuses another issuer or audience', async () => {
    await rejects(sign({}, { issuer: 'https://securetoken.google.com/other' }));
    await rejects(sign({}, { audience: 'other-project' }));
  });

  it('refuses expired tokens and tokens from the future', async () => {
    await rejects(sign({ exp: now() - 60 }));
    await rejects(sign({ iat: now() + 600 }));
    await rejects(sign({ auth_time: now() + 600 }));
    await rejects(sign({ auth_time: 'yesterday' }));
  });

  it('refuses a missing or malformed subject', async () => {
    await rejects(sign({ sub: undefined }));
    await rejects(sign({ sub: 'has spaces' }));
    await rejects(sign({ sub: 'x'.repeat(129) }));
  });

  it('refuses garbage and oversized tokens without parsing them', async () => {
    await rejects('not-a-token');
    await rejects(`${sign()}${'a'.repeat(5000)}`);
  });
});
