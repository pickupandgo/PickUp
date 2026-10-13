type RandomFill = (bytes: Uint8Array) => void;

/**
 * A new UUID v4 used as the Idempotency-Key for one recharge attempt. The same key is reused
 * for every retry of that attempt, so the server never creates a second payment for it.
 */
export function newIdempotencyKey(fill: RandomFill = fillRandom): string {
  const bytes = new Uint8Array(16);
  fill(bytes);
  // RFC 4122 version 4 and variant bits (arithmetic form of the usual bit masks).
  bytes[6] = (bytes[6] % 16) + 64;
  bytes[8] = (bytes[8] % 64) + 128;
  const hex = Array.from(bytes, byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function fillRandom(bytes: Uint8Array): void {
  const crypto = (
    globalThis as {
      crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
    return;
  }
  // Uniqueness is what matters for this key, not secrecy: the server scopes keys to the
  // signed-in driver. The timestamp keeps keys distinct even with a weak generator.
  const now = Date.now();
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] =
      (Math.floor(Math.random() * 256) + Math.floor(now / 256 ** (i % 6))) %
      256;
  }
}
