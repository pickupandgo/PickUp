import { createHash, timingSafeEqual } from 'node:crypto';

const KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time check of an X-Internal-Api-Key value against every configured key. Hashing first
 * gives equal-length buffers, and every key is compared, so timing reveals neither the key length
 * nor which key matched.
 */
export function matchesInternalApiKey(
  provided: string | undefined,
  keys: readonly string[],
): boolean {
  if (!provided || !KEY_PATTERN.test(provided)) {
    return false;
  }
  const candidate = digest(provided);
  let matched = false;
  for (const key of keys) {
    if (timingSafeEqual(candidate, digest(key))) {
      matched = true;
    }
  }
  return matched;
}
