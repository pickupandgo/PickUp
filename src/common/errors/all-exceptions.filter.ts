import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from './app-error';
import { ErrorCode } from './error-codes';
import { codeForStatus, defaultMessageFor, type ErrorResponseBody } from './error-response';

/** Postgres error codes that mean "busy, retry": lock timeout, serialization failure, deadlock. */
const RETRYABLE_DB_CODES = new Set(['55P03', '40001', '40P01']);

interface MappedError {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/**
 * Converts every exception into the standard `{ error: { code, message, requestId } }` body.
 * Internal details (stack traces, SQL, provider responses) are logged server-side only.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { id?: string }>();
    const response = http.getResponse<Response>();

    const mapped = this.map(exception);
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    if (mapped.status >= 500) {
      this.logger.error(
        { err: exception, code: mapped.code, requestId },
        `Request failed: ${request.method} ${request.path}`,
      );
    }

    const body: ErrorResponseBody = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(requestId ? { requestId } : {}),
        ...(mapped.details ? { details: mapped.details } : {}),
      },
    };

    if (!response.headersSent) {
      response.status(mapped.status).json(body);
    }
  }

  private map(exception: unknown): MappedError {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return { status, code: codeForStatus(status), message: defaultMessageFor(status) };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaError(exception);
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return this.unavailable();
    }

    const bodyParserError = mapBodyParserError(exception);
    if (bodyParserError) {
      return bodyParserError;
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: defaultMessageFor(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }

  private mapPrismaError(error: Prisma.PrismaClientKnownRequestError): MappedError {
    switch (error.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.CONFLICT,
          message: defaultMessageFor(HttpStatus.CONFLICT),
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ErrorCode.NOT_FOUND,
          message: defaultMessageFor(HttpStatus.NOT_FOUND),
        };
      case 'P1001':
      case 'P1002':
      case 'P1017':
      case 'P2024':
      case 'P2034':
        return this.unavailable();
      default:
        if (RETRYABLE_DB_CODES.has(extractDatabaseCode(error))) {
          return this.unavailable();
        }
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ErrorCode.INTERNAL_ERROR,
          message: defaultMessageFor(HttpStatus.INTERNAL_SERVER_ERROR),
        };
    }
  }

  private unavailable(): MappedError {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: defaultMessageFor(HttpStatus.SERVICE_UNAVAILABLE),
    };
  }
}

interface HttpErrorLike {
  readonly type?: unknown;
  readonly status?: unknown;
  readonly expose?: unknown;
}

/**
 * Errors raised by Express body parsing (http-errors objects) before a route runs. Their
 * messages can echo request content, so only safe defaults are returned.
 */
function mapBodyParserError(exception: unknown): MappedError | null {
  if (!exception || typeof exception !== 'object') {
    return null;
  }
  const error = exception as HttpErrorLike;
  if (error.type === 'entity.too.large') {
    return {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      message: defaultMessageFor(HttpStatus.PAYLOAD_TOO_LARGE),
    };
  }
  if (error.type === 'entity.parse.failed') {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: ErrorCode.VALIDATION_FAILED,
      message: 'Request body is not valid JSON',
    };
  }
  if (
    typeof error.status === 'number' &&
    error.status >= 400 &&
    error.status < 500 &&
    error.expose === true
  ) {
    return {
      status: error.status,
      code: codeForStatus(error.status),
      message: defaultMessageFor(error.status),
    };
  }
  return null;
}

/** Best-effort extraction of the underlying Postgres SQLSTATE from a Prisma error. */
export function extractDatabaseCode(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = error.meta;
  const candidates = [meta?.['code'], meta?.['database_error_code'], meta?.['driverAdapterError']];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      const nested = candidate as Record<string, unknown>;
      const cause = nested['cause'] as Record<string, unknown> | undefined;
      const code = cause?.['originalCode'] ?? cause?.['code'] ?? nested['code'];
      if (typeof code === 'string') {
        return code;
      }
    }
  }
  return '';
}
