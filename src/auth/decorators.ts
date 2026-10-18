import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'engine:isPublic';

/** No token needed (health, the non-authoritative fare estimates). Everything else needs one. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export interface AuthenticatedRequest extends Request {
  user?: { readonly subject: string };
}

/**
 * The verified Firebase UID of the caller. Identity never comes from the body, the query or the
 * path: an id sent there must equal this subject (assertSameIdentity).
 */
export const CurrentSubject = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const subject = context.switchToHttp().getRequest<AuthenticatedRequest>()
      .user?.subject;
    if (!subject) {
      // The global guard runs first; reaching here without a subject is a wiring bug.
      throw new Error('CurrentSubject used on a route without authentication');
    }
    return subject;
  },
);
