import { generateKeyPairSync, type KeyObject } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { SigningKeyProvider } from '../../src/auth/signing-key.provider';
import { TEST_FIREBASE_PROJECT, TEST_ISSUER } from './test-config';

export interface SignOptions {
  readonly audience?: string;
  readonly issuer?: string;
  /** Negative values produce an already-expired token. */
  readonly expiresInSeconds?: number;
  readonly kid?: string;
  readonly privateKey?: KeyObject;
  /** Seconds since the epoch. Defaults to now (a token from a sign-in that just happened). */
  readonly authTime?: number;
  /** `phone_number` claim, as Firebase phone sign-in sets it. Omitted when undefined. */
  readonly phoneNumber?: string;
  /** `firebase.sign_in_provider`. Defaults to "phone". */
  readonly signInProvider?: string;
}

/** Issues Firebase-shaped RS256 ID tokens signed by a key generated for this test run. */
export class TestTokenIssuer {
  readonly kid = 'integration-key-1';
  readonly publicKey: KeyObject;
  private readonly privateKey: KeyObject;

  constructor() {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.publicKey = publicKey;
    this.privateKey = privateKey;
  }

  sign(subject: string, options: SignOptions = {}): string {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        iat: now,
        exp: now + (options.expiresInSeconds ?? 3600),
        auth_time: options.authTime ?? now,
        ...(options.phoneNumber === undefined ? {} : { phone_number: options.phoneNumber }),
        firebase: { sign_in_provider: options.signInProvider ?? 'phone' },
      },
      options.privateKey ?? this.privateKey,
      {
        algorithm: 'RS256',
        keyid: options.kid ?? this.kid,
        subject,
        issuer: options.issuer ?? TEST_ISSUER,
        audience: options.audience ?? TEST_FIREBASE_PROJECT,
      },
    );
  }
}

export class StaticSigningKeyProvider extends SigningKeyProvider {
  constructor(private readonly keys: ReadonlyMap<string, KeyObject>) {
    super();
  }

  getKey(kid: string): Promise<KeyObject | undefined> {
    return Promise.resolve(this.keys.get(kid));
  }
}
