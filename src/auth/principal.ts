import type { Request } from 'express';
import type { DriverApprovalStatus, UserRole } from '../generated/prisma/enums';

export interface DriverPrincipal {
  readonly id: string;
  readonly approvalStatus: DriverApprovalStatus;
}

export interface CustomerPrincipal {
  readonly id: string;
}

/**
 * Facts about the token that authenticated this request. Never used to decide who the caller is
 * or what they may do (that comes from our database); only for step-up checks on sensitive
 * actions such as changing the payout bank account.
 */
export interface AuthSession {
  /** When the user last actually signed in (`auth_time`); unchanged by token refreshes. */
  readonly authenticatedAt: Date | null;
  /** `firebase.sign_in_provider`, e.g. "phone". */
  readonly signInProvider: string | null;
  /** `phone_number` claim. */
  readonly phoneNumber: string | null;
}

/** The authenticated caller, resolved from a verified token plus our own database records. */
export interface Principal {
  readonly userId: string;
  readonly role: UserRole;
  /** Present when the user has a driver profile. */
  readonly driver: DriverPrincipal | null;
  /** Present when the user has a customer profile. */
  readonly customer: CustomerPrincipal | null;
  readonly session: AuthSession;
}

/** Express request after AuthGuard. The request id (`id`) is added by pino-http. */
export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}
