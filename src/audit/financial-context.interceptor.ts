import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { ACCESS_POLICY_KEY, type AccessPolicy } from '../auth/decorators';
import type { AuthenticatedRequest } from '../auth/principal';
import { type ActorType, FinancialContext, type FinancialContextValues } from './financial-context';

/** What the interceptor reads from an Express request after the guards ran. */
export interface RoutedRequest {
  readonly id?: unknown;
  readonly method?: string;
  readonly path?: string;
  readonly route?: { readonly path?: unknown };
  readonly principal?: AuthenticatedRequest['principal'];
}

const USER_ACTORS: ReadonlySet<string> = new Set<ActorType>(['ADMIN', 'DRIVER', 'CUSTOMER']);

/**
 * The financial context of an API request: the authenticated user and role, the trip engine for
 * the internal API, otherwise unattributed (a webhook names its provider once it is verified).
 */
export function requestFinancialContext(
  request: RoutedRequest,
  policy: AccessPolicy | undefined,
): FinancialContextValues {
  const principal = request.principal;
  let actorType: ActorType = 'UNATTRIBUTED';
  let actorUserId: string | null = null;
  if (policy === 'INTERNAL') {
    actorType = 'ENGINE';
  } else if (principal && USER_ACTORS.has(principal.role)) {
    actorType = principal.role;
    actorUserId = principal.userId;
  }
  const route = typeof request.route?.path === 'string' ? request.route.path : request.path;
  return {
    actorType,
    actorUserId,
    requestId: typeof request.id === 'string' ? request.id : null,
    origin: request.method && route ? `${request.method} ${route}` : null,
    providerEventId: null,
  };
}

/**
 * Global: runs each HTTP request's handler inside its financial context (payment flow Phase 7),
 * so every transaction it opens tells the financial event triggers who acted and in which
 * request. Interceptors run after the guards, so the principal is known. Changes nothing else.
 */
@Injectable()
export class FinancialContextInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const policy = this.reflector.getAllAndOverride<AccessPolicy | undefined>(ACCESS_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const values = requestFinancialContext(
      context.switchToHttp().getRequest<RoutedRequest>(),
      policy,
    );
    return new Observable((subscriber) =>
      FinancialContext.run(values, () => next.handle().subscribe(subscriber)),
    );
  }
}
