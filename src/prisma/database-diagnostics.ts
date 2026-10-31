export interface ReadinessObservation {
  phase: 'initialize' | 'query' | 'complete';
  initializeMs?: number;
  queryMs?: number;
}

/** Classify without logging SQL, credentials, query values, stacks or raw driver messages. */
export function databaseFailure(error: unknown) {
  type DiagnosticError = {
    code?: unknown;
    name?: unknown;
    message?: unknown;
    kind?: unknown;
    cause?: unknown;
    meta?: { code?: unknown; driverAdapterError?: { cause?: unknown } };
  };
  const value = error && typeof error === 'object' ? (error as DiagnosticError) : {};
  const nested = value.meta?.driverAdapterError?.cause ?? value.cause;
  const driver = nested && typeof nested === 'object' ? (nested as DiagnosticError) : {};
  const suppliedCode = driver.code ?? value.meta?.code ?? value.code;
  const code =
    typeof suppliedCode === 'string' &&
    /^(?:P[0-9]{4}|[0-9A-Z]{5}|E[A-Z_]{2,30})$/.test(suppliedCode)
      ? suppliedCode
      : undefined;
  const message = typeof value.message === 'string' ? value.message : '';
  const category =
    code === '53300' || driver.kind === 'TooManyConnections'
      ? 'CONNECTION_LIMIT'
      : code === '57014'
        ? 'STATEMENT_TIMEOUT'
        : ['ECONNRESET', 'EPIPE', '57P01', '57P02', '57P03'].includes(code ?? '') ||
            driver.kind === 'ConnectionClosed'
          ? 'CONNECTION_DROPPED'
          : value.name === 'TimeoutError'
            ? 'APPLICATION_DEADLINE'
            : driver.kind === 'SocketTimeout' ||
                ['ETIMEDOUT', 'P1002', 'P2024'].includes(code ?? '') ||
                /timeout|timed out/i.test(message)
              ? 'TIMEOUT'
              : driver.kind === 'DatabaseNotReachable' ||
                  ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'P1001', 'P1017'].includes(code ?? '')
                ? 'CONNECTION_UNAVAILABLE'
                : 'DATABASE_ERROR';
  return { category, ...(code ? { errorCode: code } : {}) };
}
