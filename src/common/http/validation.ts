import { HttpStatus, ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';

export interface FieldIssue {
  readonly field: string;
  readonly issues: readonly string[];
}

/**
 * Global validation: unknown properties are rejected (no mass assignment), values are never
 * coerced implicitly, and error output never echoes submitted values.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    validationError: { target: false, value: false },
    exceptionFactory: (errors: ValidationError[]) =>
      new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'Request validation failed',
        {
          fields: flattenValidationErrors(errors),
        },
      ),
  });
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): FieldIssue[] {
  const result: FieldIssue[] = [];
  for (const error of errors) {
    const field = parent ? `${parent}.${error.property}` : error.property;
    if (error.constraints) {
      result.push({ field, issues: Object.values(error.constraints) });
    }
    if (error.children && error.children.length > 0) {
      result.push(...flattenValidationErrors(error.children, field));
    }
  }
  return result;
}
