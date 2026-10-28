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

export interface DriverRegistrationParams {
  readonly legalName?: string | null;
  readonly vehicleType?: string | null;
  readonly vehicleMakeModel?: string | null;
  readonly vehicleRegistrationNumber?: string | null;
  readonly drivingLicenseNumber?: string | null;
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
    paramsOrLegalName?: DriverRegistrationParams | string | null,
  ): Promise<DriverRegistrationResult> {
    const params: DriverRegistrationParams =
      typeof paramsOrLegalName === 'object' && paramsOrLegalName !== null
        ? paramsOrLegalName
        : { legalName: paramsOrLegalName };

    // A driver phone is an authentication fact. Never substitute a request-body value when a
    // social/email Firebase token has no verified phone_number claim.
    const phone = identity.phoneNumber;

    if (phone === null || !E164_PHONE.test(phone)) {
      throw new AppError(
        ErrorCode.PHONE_VERIFICATION_REQUIRED,
        HttpStatus.FORBIDDEN,
        'Verify your mobile number with an OTP to continue',
      );
    }

    const trimmedLegalName =
      identity.name ?? (params.legalName ? params.legalName.trim().slice(0, 120) : null);
    const trimmedEmail = identity.email;
    const trimmedVehicleType = params.vehicleType ? params.vehicleType.trim().slice(0, 30) : null;
    const trimmedVehicleMakeModel = params.vehicleMakeModel
      ? params.vehicleMakeModel.trim().slice(0, 100)
      : null;
    const trimmedVehicleRegistration = params.vehicleRegistrationNumber
      ? params.vehicleRegistrationNumber.trim().toUpperCase().slice(0, 30)
      : null;
    const trimmedLicenseNumber = params.drivingLicenseNumber
      ? params.drivingLicenseNumber.trim().toUpperCase().slice(0, 50)
      : null;

    const [row] = await this.prisma.$queryRaw<RegistrationRow[]>`
      SELECT outcome,
             registered_user_id AS "userId",
             registered_driver_id AS "driverId"
        FROM register_driver(
          ${identity.provider},
          ${identity.subject},
          ${phone},
          ${trimmedLegalName},
          ${trimmedEmail},
          ${trimmedVehicleType},
          ${trimmedVehicleMakeModel},
          ${trimmedVehicleRegistration},
          ${trimmedLicenseNumber}
        )`;

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
      email: driver.email,
      vehicleType: driver.vehicleType,
      vehicleMakeModel: driver.vehicleMakeModel,
      vehicleRegistrationNumber: driver.vehicleRegistrationNumber,
      drivingLicenseNumber: driver.drivingLicenseNumber,
      walletBalancePaise: Number(driver.wallet?.balancePaise ?? 0n),
      createdAt: driver.createdAt.toISOString(),
    };
  }
}
