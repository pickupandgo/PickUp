import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { AppConfig } from '../../config/app-config';
import { ensureRequestId } from '../http/request-id';

/** Paths whose values must never reach log storage. */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-razorpay-signature"]',
  'req.headers["idempotency-key"]',
  'req.headers["x-internal-api-key"]',
  'res.headers["set-cookie"]',
  '*.authorization',
  '*.keySecret',
  '*.webhookSecret',
  '*.razorpaySignature',
  '*.password',
  '*.token',
  '*.accountNumber',
  '*.confirmAccountNumber',
  '*.account_number',
];

interface SerializableRequest {
  readonly id?: unknown;
  readonly method?: string;
  readonly url?: string;
}

interface SerializableResponse {
  readonly statusCode?: number;
}

/**
 * Structured JSON logs with a request id on every line. Request/response logs carry only
 * method, path and status: no headers, bodies or query strings.
 */
export function buildLoggerModule(config: AppConfig): DynamicModule {
  return LoggerModule.forRoot({
    pinoHttp: {
      level: config.logLevel,
      base: { service: 'multipleride-backend', env: config.nodeEnv },
      // Normally already assigned by requestIdMiddleware; this keeps logs correct either way.
      genReqId: (request, response) => ensureRequestId(request, response),
      redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
      serializers: {
        req: (request: SerializableRequest) => ({
          id: request.id,
          method: request.method,
          path: stripQuery(request.url),
        }),
        res: (response: SerializableResponse) => ({ statusCode: response.statusCode }),
      },
      customLogLevel: (_request, response, error) => {
        if (error || response.statusCode >= 500) {
          return 'error';
        }
        return response.statusCode >= 400 ? 'warn' : 'info';
      },
      autoLogging: {
        ignore: (request) => (request.url ?? '').startsWith('/health'),
      },
      quietReqLogger: true,
      transport:
        config.nodeEnv === 'development'
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:standard' } }
          : undefined,
    },
  });
}

function stripQuery(url: string | undefined): string | undefined {
  if (!url) {
    return url;
  }
  const index = url.indexOf('?');
  return index === -1 ? url : url.slice(0, index);
}
