import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { engineError } from '../common/errors';
import { type AuthenticatedRequest, IS_PUBLIC_KEY } from './decorators';
import { TokenVerifier } from './token-verifier.service';

const BEARER_TOKEN = /^Bearer ([A-Za-z0-9._-]+)$/;

/**
 * Global guard, fail closed: every route needs a verified Firebase ID token unless it is
 * explicitly @Public(). Which booking or trip the caller may touch is checked by the services
 * (the customer of the booking, the driver of the trip).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return false;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header) {
      throw engineError(
        HttpStatus.UNAUTHORIZED,
        'AUTH_REQUIRED',
        'Authentication required',
      );
    }
    const token = BEARER_TOKEN.exec(header)?.[1];
    if (!token) {
      throw engineError(
        HttpStatus.UNAUTHORIZED,
        'AUTH_INVALID_TOKEN',
        'Token is invalid or expired',
      );
    }
    const identity = await this.verifier.verify(token);
    request.user = { subject: identity.subject };
    return true;
  }
}
