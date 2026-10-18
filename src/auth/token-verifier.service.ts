import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { engineError } from '../common/errors';
import { ENGINE_CONFIG, type EngineConfig } from '../config/engine-config';
import { SigningKeyProvider } from './signing-key.provider';

export interface VerifiedIdentity {
  /** Firebase UID: the customer subject or driver subject sent to the payment backend. */
  readonly subject: string;
}

const MAX_TOKEN_LENGTH = 4_096;
const CLOCK_TOLERANCE_SECONDS = 5;
/** Same subject format as the payment backend (Firebase UIDs: up to 128 URL-safe characters). */
const SUBJECT_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const invalidToken = () =>
  engineError(
    HttpStatus.UNAUTHORIZED,
    'AUTH_INVALID_TOKEN',
    'Token is invalid or expired',
  );

/**
 * Verifies Firebase ID tokens following Firebase's rules for third-party JWT libraries (same
 * checks as raj_backend): RS256 only, `kid` must match a published key, and `iss`, `aud`, `exp`,
 * `iat`, `auth_time` and `sub` are all checked. Any failure is a 401 with no detail.
 */
@Injectable()
export class TokenVerifier {
  constructor(
    @Inject(ENGINE_CONFIG) private readonly config: EngineConfig,
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
    if (
      typeof payload.iat !== 'number' ||
      payload.iat > now + CLOCK_TOLERANCE_SECONDS
    ) {
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
    if (typeof subject !== 'string' || !SUBJECT_PATTERN.test(subject)) {
      throw invalidToken();
    }
    return { subject };
  }
}
