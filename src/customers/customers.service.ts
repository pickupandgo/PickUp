import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Principal, SignedInIdentity } from '../auth/principal';
import { requireCustomer } from '../auth/require-driver';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type { CustomerAccountResponse } from './customers.dto';

/** E.164, as Firebase puts it in the `phone_number` claim. */
const E164_PHONE = /^\+[1-9][0-9]{6,14}$/;

type RegistrationOutcome = 'CREATED' | 'EXISTING' | 'PHONE_TAKEN' | 'ROLE_CONFLICT' | 'DISABLED';

interface RegistrationRow {
  readonly outcome: RegistrationOutcome;
  readonly userId: string | null;
  readonly customerId: string | null;
}

export interface RegistrationResult {
  readonly account: CustomerAccountResponse;
  readonly created: boolean;
}

/**
 * Customer accounts. A customer exists only once a sign-in with a verified phone has registered:
 * email, Google or Apple sign-in alone is not enough, the app must verify and link a phone with
 * an OTP first. Registration goes through register_customer() (see its migration): the API role
 * can't create users any other way, and a phone already used by another account is never
 * re-linked.
 */
@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async register(
    identity: SignedInIdentity,
  ): Promise<RegistrationResult> {
    const phone = identity.phoneNumber;
    if (phone === null || !E164_PHONE.test(phone)) {
      throw new AppError(
        ErrorCode.PHONE_VERIFICATION_REQUIRED,
        HttpStatus.FORBIDDEN,
        'Verify your mobile number with an OTP to continue',
      );
    }

    // Identity/profile facts originate only from the verified Firebase token. This bootstrap
    // endpoint intentionally accepts no body: callers cannot attach an arbitrary email or UID.
    const name = identity.name;
    const email = identity.email;

    const [row] = await this.prisma.$queryRaw<RegistrationRow[]>`
      SELECT outcome,
             registered_user_id AS "userId",
             registered_customer_id AS "customerId"
        FROM register_customer(${identity.provider}, ${identity.subject}, ${phone}, ${name}, ${email})`;

    switch (row?.outcome) {
      case 'CREATED':
      case 'EXISTING': {
        if (!row.customerId) {
          throw new Error('register_customer returned no customer');
        }
        if (row.outcome === 'CREATED') {
          this.logger.log({ customerId: row.customerId }, 'Customer registered');
        }
        return { account: await this.load(row.customerId), created: row.outcome === 'CREATED' };
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
          'This sign-in belongs to a driver or staff account and cannot be used to book',
        );
      case 'DISABLED':
        throw new AppError(
          ErrorCode.ACCOUNT_DISABLED,
          HttpStatus.FORBIDDEN,
          'This account is disabled',
        );
      default:
        throw new Error('register_customer returned an unexpected outcome');
    }
  }

  async checkPhone(phone: string): Promise<{ exists: boolean }> {
    if (!phone || typeof phone !== 'string') {
      return { exists: false };
    }
    const trimmed = phone.trim();
    const cleanPhone = trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
    const customer = await this.prisma.customer.findFirst({
      where: {
        user: {
          phone: cleanPhone,
          status: 'ACTIVE',
        },
      },
      select: { id: true },
    });
    return { exists: Boolean(customer) };
  }

  async get(principal: Principal): Promise<CustomerAccountResponse> {
    return this.load(requireCustomer(principal).id);
  }

  private async load(customerId: string): Promise<CustomerAccountResponse> {
    const customer = await this.prisma.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: { user: { select: { phone: true, status: true } } },
    });
    return {
      customerId: customer.id,
      phone: customer.user.phone,
      status: customer.user.status,
      name: customer.name ?? null,
      email: customer.email ?? null,
      createdAt: customer.createdAt.toISOString(),
    };
  }
}
