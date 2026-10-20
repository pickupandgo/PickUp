import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { Principal } from './principal';
import type { VerifiedIdentity } from './token-verifier.service';

/**
 * Maps a verified external identity to our user record. Roles, driver profile and account
 * status always come from our database, never from token claims, so suspending a user here
 * takes effect on their next request.
 */
@Injectable()
export class PrincipalService {
  private readonly logger = new Logger(PrincipalService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async resolve(verified: VerifiedIdentity): Promise<Principal> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_subject: { provider: this.config.auth.provider, subject: verified.subject },
      },
      select: {
        user: {
          select: {
            id: true,
            role: true,
            status: true,
            driver: { select: { id: true, approvalStatus: true } },
            customer: { select: { id: true } },
          },
        },
      },
    });

    if (!identity) {
      // The UID is a pseudonymous id, not a credential; ops need it to link or provision accounts.
      this.logger.log({ subject: verified.subject }, 'Sign-in for an unregistered identity');
      throw new AppError(
        ErrorCode.USER_NOT_PROVISIONED,
        HttpStatus.FORBIDDEN,
        'This account is not registered with MultipleRide',
      );
    }

    const { user } = identity;
    if (user.status !== 'ACTIVE') {
      throw new AppError(
        ErrorCode.ACCOUNT_DISABLED,
        HttpStatus.FORBIDDEN,
        'This account is disabled',
      );
    }

    return {
      userId: user.id,
      role: user.role,
      driver: user.driver
        ? { id: user.driver.id, approvalStatus: user.driver.approvalStatus }
        : null,
      customer: user.customer ? { id: user.customer.id } : null,
      session: {
        authenticatedAt: verified.authTime === null ? null : new Date(verified.authTime * 1000),
        signInProvider: verified.signInProvider,
        phoneNumber: verified.phoneNumber,
      },
    };
  }
}
