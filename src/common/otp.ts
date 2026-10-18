import { randomInt, timingSafeEqual } from 'node:crypto';

/** A 4-digit handover OTP (same format as the prototype), from a CSPRNG. */
export function generateOtp(): string {
  return randomInt(1000, 10_000).toString();
}

/** Constant-time OTP comparison. */
export function otpMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(provided, 'utf8'),
  );
}
