import { HttpStatus } from '@nestjs/common';
import { engineError } from '../common/errors';

/**
 * Apps used to send their own customerId / driverId. They may still, for compatibility, but it
 * must be the signed-in user: anything else is a 403 (never trusted, never used).
 */
export function assertSameIdentity(
  subject: string,
  claimed: unknown,
  field: string,
): void {
  if (claimed === undefined || claimed === null || claimed === '') {
    return;
  }
  if (claimed !== subject) {
    throw engineError(
      HttpStatus.FORBIDDEN,
      'IDENTITY_MISMATCH',
      `${field} does not match the signed-in user`,
    );
  }
}
