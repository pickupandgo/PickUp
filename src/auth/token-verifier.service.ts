import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { SigningKeyProvider } from './signing-key.provider';

export interface VerifiedIdentity {
  /** Provider subject (Firebase UID). */
  readonly subject: string;
  /**
   * `phone_number` claim, when the provider includes one. Never used for authorization; only
   * compared with the registered phone during a step-up.
   */
  readonly phoneNumber: string | null;
  /**
   * `auth_time` (seconds since the epoch): when the user last actually signed in. Refreshing an
   * ID token keeps it; only a new sign-in or re-authentication moves it, which is what a step-up
   * relies on.
   */
  readonly authTime: number | null;
  /** `firebase.sign_in_provider`, e.g. "phone". */
  readonly signInProvider: string | null;
  /** A verified email address, when Firebase includes one in the ID token. */
  readonly email: string | null;
  /** The display name asserted by Firebase, when available. Never used for authorization. */
  readonly name: string | null;
}

const MAX_TOKEN_LENGTH = 4_096;
const CLOCK_TOLERANCE_SECONDS = 5;
const MAX_SUBJECT_LENGTH = 128;

const invalidToken = (): AppError =>
  new AppError(
    ErrorCode.AUTH_INVALID_TOKEN,
    HttpStatus.UNAUTHORIZED,
    'Token is invalid or expired',
  );

/**
 * Verifies identity-provider ID tokens following Firebase's rules for third-party JWT
 * libraries: RS256 only, `kid` must match a published key, and `iss`, `aud`, `exp`, `iat`,
 * `auth_time` and `sub` are all checked. Any failure is a 401 with no detail.
 */
@Injectable()
export class TokenVerifier {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly keys: SigningKeyProvider,
  ) {}

  async verify(token: string): Promise<VerifiedIdentity> {
    if (token.length > MAX_TOKEN_LENGTH) {
      throw invalidToken();
    }

    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === 'string') {
      throw invalidToken();
    }
    const { alg, kid } = decoded.header;
    if (alg !== 'RS256' || typeof kid !== 'string' || kid.length === 0) {
      throw invalidToken();
    }

    const key = await this.keys.getKey(kid);
    if (!key) {
      throw invalidToken();
    }

    let payload: JwtPayload;
    try {
      const verified = jwt.verify(token, key, {
        algorithms: ['RS256'],
        issuer: this.config.auth.issuer,
        audience: this.config.auth.audience,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      if (typeof verified === 'string') {
        throw invalidToken();
      }
      payload = verified;
    } catch {
      throw invalidToken();
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number') {
      throw invalidToken();
    }
    if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_TOLERANCE_SECONDS) {
      throw invalidToken();
    }
    const authTime: unknown = payload['auth_time'];
    if (
      authTime !== undefined &&
      (typeof authTime !== 'number' || authTime > now + CLOCK_TOLERANCE_SECONDS)
    ) {
      throw invalidToken();
    }
    const subject = payload.sub;
    if (
      typeof subject !== 'string' ||
      subject.length === 0 ||
      subject.length > MAX_SUBJECT_LENGTH
    ) {
      throw invalidToken();
    }

    const phone: unknown = payload['phone_number'];
    const email: unknown = payload['email'];
    const emailVerified: unknown = payload['email_verified'];
    const name: unknown = payload['name'];
    const firebase: unknown = payload['firebase'];
    const provider: unknown =
      typeof firebase === 'object' && firebase !== null
        ? (firebase as Record<string, unknown>)['sign_in_provider']
        : undefined;
    return {
      subject,
      phoneNumber: typeof phone === 'string' && phone.length <= 20 ? phone : null,
      authTime: typeof authTime === 'number' && Number.isInteger(authTime) ? authTime : null,
      signInProvider: typeof provider === 'string' && provider.length <= 40 ? provider : null,
      // An email is profile data only, but accepting an unverified email claim would still make
      // the server persist a value the identity provider has not confirmed.
      email:
        emailVerified === true && typeof email === 'string' && email.length <= 255 ? email : null,
      name:
        typeof name === 'string' && name.trim().length > 0 && name.length <= 120
          ? name.trim()
          : null,
    };
  }
}
