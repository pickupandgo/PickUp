import { HttpStatus } from '@nestjs/common';
import type { z } from 'zod';
import { engineError } from './errors';

/**
 * Validates a request body (or query) with a zod schema. Unknown fields are refused by the
 * strict schemas used here, so a client can never slip an amount, a status or an identity in.
 */
export function parseRequest<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const parsed = schema.safeParse(input ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  const fields = parsed.error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    issue:
      issue.code === 'unrecognized_keys'
        ? `not accepted: ${issue.keys.join(', ')}`
        : issue.message,
  }));
  throw engineError(
    HttpStatus.BAD_REQUEST,
    'VALIDATION_FAILED',
    'Request validation failed',
    {
      fields,
    },
  );
}
