/**
 * Standalone phone formatting and validation utilities.
 * Decoupled from authService to break circular dependency with OtpCooldownManager.
 */

/** Normalizes and validates Indian phone numbers into E.164 (+91XXXXXXXXXX) format */
export const formatToE164 = (phoneNumber: string): string => {
  const trimmed = phoneNumber.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (digitsOnly.length === 10) {
    return `+91${digitsOnly}`;
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return `+${digitsOnly}`;
  }
  if (trimmed.startsWith('+') && digitsOnly.length >= 10 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }
  throw new Error('Please enter a valid 10-digit mobile number.');
};

/** Normalizes any valid phone string into E.164 format (+91XXXXXXXXXX) safely without throwing */
export const normalizePhoneNumber = (phone?: string | null): string | null => {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  try {
    return formatToE164(trimmed);
  } catch {
    return null;
  }
};
