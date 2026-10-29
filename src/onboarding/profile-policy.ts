import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

export const PROFILE_FIELDS = [
  'name',
  'dateOfBirth',
  'email',
  'residentialAddress',
  'city',
  'state',
  'pinCode',
] as const;

/** Strict calendar date, UTC throughout; no permanent age column. */
export function calendarDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new AppError(ErrorCode.VALIDATION_FAILED, 400, 'Enter a valid calendar date');
  return parsed;
}
export function ageOn(date: Date, today = new Date()): number {
  let age = today.getUTCFullYear() - date.getUTCFullYear();
  if (
    today.getUTCMonth() < date.getUTCMonth() ||
    (today.getUTCMonth() === date.getUTCMonth() && today.getUTCDate() < date.getUTCDate())
  )
    age--;
  return age;
}
export function validBirthDate(value: string, today = new Date()): Date {
  const date = calendarDate(value);
  if (date > today || ageOn(date, today) > 120)
    throw new AppError(
      ErrorCode.VALIDATION_FAILED,
      400,
      'Date of birth must be in the past and within 120 years',
    );
  return date;
}
/** Authenticated encryption bound to the driver. Ciphertext cannot be moved to another account. */
export function encryptLicence(value: string, key: string, driverId: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonce);
  cipher.setAAD(Buffer.from(driverId));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    nonce.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}
export function decryptLicence(value: string, key: string, driverId: string): string {
  const [version, nonce, tag, encrypted] = value.split(':');
  if (version !== 'v1' || !nonce || !tag || !encrypted)
    throw new Error('Unsupported protected identity format');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(nonce, 'hex'),
  );
  cipher.setAAD(Buffer.from(driverId));
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return Buffer.concat([cipher.update(Buffer.from(encrypted, 'hex')), cipher.final()]).toString(
    'utf8',
  );
}
