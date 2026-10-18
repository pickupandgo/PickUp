import { createPublicKey, type KeyObject } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { describeError, engineError } from '../common/errors';
import { ENGINE_CONFIG, type EngineConfig } from '../config/engine-config';

/** Resolves the public key for a token's `kid`. Abstract so tests can supply local keys. */
export abstract class SigningKeyProvider {
  abstract getKey(kid: string): Promise<KeyObject | undefined>;
}

const FETCH_TIMEOUT_MS = 5_000;
const MAX_JWKS_BYTES = 64 * 1024;
const DEFAULT_CACHE_SECONDS = 3_600;
const MIN_CACHE_SECONDS = 60;
const MAX_CACHE_SECONDS = 86_400;
/** Unknown `kid`s can force at most one refetch per window, so random kids cannot flood Google. */
const UNKNOWN_KID_REFETCH_COOLDOWN_MS = 30_000;
/** After a failed refresh, keep serving cached keys and retry after this delay. */
const FAILED_REFRESH_RETRY_MS = 60_000;

const jwksSchema = z.object({
  keys: z
    .array(
      z.looseObject({
        kid: z.string().min(1).max(256),
        kty: z.string(),
        n: z.string().optional(),
        e: z.string().optional(),
        alg: z.string().optional(),
        use: z.string().optional(),
      }),
    )
    .max(50),
});

/**
 * Fetches and caches Firebase's JWKS, honouring the Cache-Control max-age Google sends. Only
 * RSA signing keys for RS256 are accepted. Same implementation as raj_backend's.
 */
@Injectable()
export class RemoteJwksKeyProvider extends SigningKeyProvider {
  private readonly logger = new Logger(RemoteJwksKeyProvider.name);
  private keys = new Map<string, KeyObject>();
  private expiresAt = 0;
  private lastFetchAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(@Inject(ENGINE_CONFIG) private readonly config: EngineConfig) {
    super();
  }

  async getKey(kid: string): Promise<KeyObject | undefined> {
    if (this.keys.size === 0 || Date.now() >= this.expiresAt) {
      await this.refresh(this.keys.size > 0);
    }
    let key = this.keys.get(kid);
    if (
      !key &&
      Date.now() - this.lastFetchAt >= UNKNOWN_KID_REFETCH_COOLDOWN_MS
    ) {
      // Keys rotate: a new kid may be published before our cache expires.
      await this.refresh(true);
      key = this.keys.get(kid);
    }
    return key;
  }

  private async refresh(allowStale: boolean): Promise<void> {
    if (!this.inflight) {
      this.inflight = this.fetchKeys().finally(() => {
        this.inflight = null;
      });
    }
    try {
      await this.inflight;
    } catch (error) {
      this.expiresAt = Date.now() + FAILED_REFRESH_RETRY_MS;
      if (allowStale) {
        this.logger.warn({
          msg: 'JWKS refresh failed; continuing with cached keys',
          error: describeError(error),
        });
        return;
      }
      this.logger.error({
        msg: 'JWKS fetch failed and no cached keys are available',
        error: describeError(error),
      });
      throw engineError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'AUTH_PROVIDER_UNAVAILABLE',
        'Authentication is temporarily unavailable, please retry',
      );
    }
  }

  private async fetchKeys(): Promise<void> {
    this.lastFetchAt = Date.now();
    const response = await fetch(this.config.auth.jwksUrl, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`JWKS endpoint responded with HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > MAX_JWKS_BYTES) {
      throw new Error('JWKS response exceeds the size limit');
    }
    const parsed = jwksSchema.parse(JSON.parse(text));
    const keys = new Map<string, KeyObject>();
    for (const jwk of parsed.keys) {
      const usable =
        jwk.kty === 'RSA' &&
        typeof jwk.n === 'string' &&
        typeof jwk.e === 'string' &&
        (jwk.use === undefined || jwk.use === 'sig') &&
        (jwk.alg === undefined || jwk.alg === 'RS256');
      if (usable) {
        keys.set(
          jwk.kid,
          createPublicKey({
            key: { kty: 'RSA', n: jwk.n, e: jwk.e },
            format: 'jwk',
          }),
        );
      }
    }
    if (keys.size === 0) {
      throw new Error('JWKS contained no usable RS256 signing keys');
    }
    this.keys = keys;
    this.expiresAt =
      Date.now() +
      cacheLifetimeSeconds(response.headers.get('cache-control')) * 1000;
  }
}

export function cacheLifetimeSeconds(cacheControl: string | null): number {
  const match = cacheControl ? /max-age=(\d+)/i.exec(cacheControl) : null;
  const seconds = match?.[1]
    ? Number.parseInt(match[1], 10)
    : DEFAULT_CACHE_SECONDS;
  return Math.min(MAX_CACHE_SECONDS, Math.max(MIN_CACHE_SECONDS, seconds));
}
