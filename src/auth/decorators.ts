import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { AuthenticatedRequest, Principal } from './principal';

export const ACCESS_POLICY_KEY = 'multipleride:access-policy';

/** Header carrying the trip engine's server-to-server key. */
export const INTERNAL_API_KEY_HEADER = 'X-Internal-Api-Key';

/**
 * Every route must declare exactly one policy. Routes without a policy are denied by the
 * global AuthGuard, so a forgotten decorator fails closed instead of open.
 */
export type AccessPolicy = 'PUBLIC' | 'DRIVER' | 'CUSTOMER' | 'ADMIN' | 'INTERNAL';

/** No authentication (health checks, provider webhooks that carry their own signature). */
export const Public = () => SetMetadata(ACCESS_POLICY_KEY, 'PUBLIC' satisfies AccessPolicy);

/** Authenticated user with a driver profile. */
export const DriverOnly = () =>
  applyDecorators(SetMetadata(ACCESS_POLICY_KEY, 'DRIVER' satisfies AccessPolicy), ApiBearerAuth());

/** Authenticated user with the CUSTOMER role and a customer profile. */
export const CustomerOnly = () =>
  applyDecorators(
    SetMetadata(ACCESS_POLICY_KEY, 'CUSTOMER' satisfies AccessPolicy),
    ApiBearerAuth(),
  );

/** Authenticated user with the ADMIN role. */
export const AdminOnly = () =>
  applyDecorators(SetMetadata(ACCESS_POLICY_KEY, 'ADMIN' satisfies AccessPolicy), ApiBearerAuth());

/**
 * Server-to-server calls from the trip engine, authenticated with X-Internal-Api-Key. There is
 * no end-user principal on these routes.
 */
export const InternalOnly = () =>
  applyDecorators(
    SetMetadata(ACCESS_POLICY_KEY, 'INTERNAL' satisfies AccessPolicy),
    ApiHeader({ name: INTERNAL_API_KEY_HEADER, required: true }),
  );

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) {
      throw new AppError(
        ErrorCode.AUTH_REQUIRED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    return request.principal;
  },
);
