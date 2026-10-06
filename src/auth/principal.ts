import type { Request } from 'express';
import type { DriverApprovalStatus, UserRole } from '../generated/prisma/enums';

export interface DriverPrincipal {
  readonly id: string;
  readonly approvalStatus: DriverApprovalStatus;
}

export interface CustomerPrincipal {
  readonly id: string;
}

/** The authenticated caller, resolved from a verified token plus our own database records. */
export interface Principal {
  readonly userId: string;
  readonly role: UserRole;
  /** Present when the user has a driver profile. */
  readonly driver: DriverPrincipal | null;
  /** Present when the user has a customer profile. */
  readonly customer: CustomerPrincipal | null;
}

/** Express request after AuthGuard. The request id (`id`) is added by pino-http. */
export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}
