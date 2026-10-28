import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { AppError, forbidden } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ACCESS_POLICY_KEY, type AccessPolicy } from './decorators';
import { matchesInternalApiKey } from './internal-api-key';
import type { AuthenticatedRequest } from './principal';
import { PrincipalService } from './principal.service';
import { TokenVerifier } from './token-verifier.service';

const BEARER_TOKEN = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const TOKEN_POLICIES: ReadonlySet<AccessPolicy> = new Set([
  'SIGNED_IN',
  'DRIVER',
  'CUSTOMER',
  'ADMIN',
]);

/**
 * Global guard. Every route must declare @Public, @SignedIn, @DriverOnly, @CustomerOnly,
 * @AdminOnly or @InternalOnly; anything else is denied (fail closed). Object-level checks (e.g.
 * "this booking belongs to you") happen in the services, on every query.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
    private readonly principals: PrincipalService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return false;
    }

    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (policy === 'PUBLIC') {
      return true;
    }
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (policy === 'INTERNAL') {
      return this.checkInternalKey(request);
    }
    if (!policy || !TOKEN_POLICIES.has(policy)) {
      throw forbidden();
    }

    const header = request.headers.authorization;
    if (!header) {
      throw new AppError(
        ErrorCode.AUTH_REQUIRED,
        HttpStatus.UNAUTHORIZED,
        'Authentication required',
      );
    }
    const token = BEARER_TOKEN.exec(header)?.[1];
    if (!token) {
      throw new AppError(
        ErrorCode.AUTH_INVALID_TOKEN,
        HttpStatus.UNAUTHORIZED,
        'Token is invalid or expired',
      );
    }

    const identity = await this.verifier.verify(token);
    if (policy === 'SIGNED_IN') {
      // Registration routes require only a verified sign-in; shared routes (e.g. notifications,
      // chat) also allow any registered principal. Resolve principal if registered, but allow
      // unregistered identities to proceed for registration.
      request.identity = {
        provider: this.config.auth.provider,
        subject: identity.subject,
        phoneNumber: identity.phoneNumber,
        signInProvider: identity.signInProvider,
        email: identity.email,
        name: identity.name,
      };
      const principal = await this.principals.findPrincipal(identity);
      if (principal) {
        request.principal = principal;
      }
      return true;
    }
    const principal = await this.principals.resolve(identity);

    if (policy === 'DRIVER' && !principal.driver) {
      throw forbidden('This action requires a driver account');
    }
    if (policy === 'CUSTOMER' && (principal.role !== 'CUSTOMER' || !principal.customer)) {
      throw forbidden('This action requires a customer account');
    }
    if (policy === 'ADMIN' && principal.role !== 'ADMIN') {
      throw forbidden('This action requires an admin account');
    }

    request.principal = principal;
    return true;
  }

  private checkInternalKey(request: AuthenticatedRequest): boolean {
    const keys = this.config.internalApi.keys;
    if (keys.length === 0) {
      throw new AppError(
        ErrorCode.INTERNAL_API_DISABLED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'The internal API is not enabled on this server',
      );
    }
    const raw = request.headers['x-internal-api-key'];
    const provided = typeof raw === 'string' ? raw : undefined;
    if (!matchesInternalApiKey(provided, keys)) {
      throw new AppError(
        ErrorCode.INTERNAL_AUTH_INVALID,
        HttpStatus.UNAUTHORIZED,
        'Internal API key is missing or invalid',
      );
    }
    return true;
  }
}
