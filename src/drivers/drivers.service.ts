import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Principal, SignedInIdentity } from '../auth/principal';
import { requireDriver } from '../auth/require-driver';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { DriverAccountResponse } from './drivers.dto';

const E164_PHONE = /^\+[1-9][0-9]{6,14}$/;

type RegistrationOutcome = 'CREATED' | 'EXISTING' | 'PHONE_TAKEN' | 'ROLE_CONFLICT' | 'DISABLED';

interface RegistrationRow {
  readonly outcome: RegistrationOutcome;
  readonly userId: string | null;
  readonly driverId: string | null;
}

export interface DriverRegistrationResult {
  readonly account: DriverAccountResponse;
  readonly created: boolean;
}

/**
 * Driver self-registration and profile management.
 */
@Injectable()
export class DriversService {
  private readonly logger = new Logger(DriversService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(
    identity: SignedInIdentity,
    legalName?: string | null,
    phoneOverride?: string | null,
  ): Promise<DriverRegistrationResult> {
    const rawPhone = identity.phoneNumber ?? phoneOverride ?? null;
    const phone = rawPhone ? rawPhone.trim() : null;

    if (phone === null || !E164_PHONE.test(phone)) {
      throw new AppError(
        ErrorCode.PHONE_VERIFICATION_REQUIRED,
        HttpStatus.FORBIDDEN,
        'Verify your mobile number with an OTP to continue',
      );
    }

    const trimmedLegalName = legalName ? legalName.trim().slice(0, 120) : null;

    const [row] = await this.prisma.$queryRaw<RegistrationRow[]>`
      SELECT outcome,
             registered_user_id AS "userId",
             registered_driver_id AS "driverId"
        FROM register_driver(${identity.provider}, ${identity.subject}, ${phone}, ${trimmedLegalName})`;

    switch (row?.outcome) {
      case 'CREATED':
      case 'EXISTING': {
        if (!row.driverId) {
          throw new Error('register_driver returned no driver');
        }
        if (row.outcome === 'CREATED') {
          this.logger.log({ driverId: row.driverId }, 'Driver registered');
        }
        return { account: await this.load(row.driverId), created: row.outcome === 'CREATED' };
      }
      case 'PHONE_TAKEN':
        throw new AppError(
          ErrorCode.PHONE_ALREADY_REGISTERED,
          HttpStatus.CONFLICT,
          'This mobile number is already registered to another account. Please contact support',
        );
      case 'ROLE_CONFLICT':
        throw new AppError(
          ErrorCode.ACCOUNT_ROLE_CONFLICT,
          HttpStatus.CONFLICT,
          'This sign-in belongs to a customer or staff account and cannot be used as a driver',
        );
      case 'DISABLED':
        throw new AppError(
          ErrorCode.ACCOUNT_DISABLED,
          HttpStatus.FORBIDDEN,
          'This account is disabled',
        );
      default:
        throw new Error('register_driver returned an unexpected outcome');
    }
  }

  async get(principal: Principal): Promise<DriverAccountResponse> {
    return this.load(requireDriver(principal).id);
  }

  async load(driverId: string): Promise<DriverAccountResponse> {
    const driver = await this.prisma.driver.findUniqueOrThrow({
      where: { id: driverId },
      include: {
        user: { select: { id: true, phone: true, status: true } },
        wallet: { select: { balancePaise: true } },
      },
    });

    return {
      driverId: driver.id,
      userId: driver.userId,
      phone: driver.user.phone,
      approvalStatus: driver.approvalStatus,
      legalName: driver.legalName,
      walletBalancePaise: Number(driver.wallet?.balancePaise ?? 0n),
      createdAt: driver.createdAt.toISOString(),
    };
  }
}
