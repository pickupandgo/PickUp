import { databaseFailure } from './database-diagnostics';
describe('Sanitized database diagnostics', () => {
  it.each([
    ['53300', 'CONNECTION_LIMIT'],
    ['57014', 'STATEMENT_TIMEOUT'],
    ['ECONNRESET', 'CONNECTION_DROPPED'],
    ['57P01', 'CONNECTION_DROPPED'],
    ['P1001', 'CONNECTION_UNAVAILABLE'],
    ['P2024', 'TIMEOUT'],
  ])('classifies %s without exposing its message', (code, category) => {
    const result = databaseFailure({
      code,
      message: 'sensitive-sentinel',
      detail: 'private-sentinel',
    });
    expect(result).toEqual({ category, errorCode: code });
    expect(JSON.stringify(result)).not.toMatch(/sentinel/);
  });
  it('identifies the application deadline separately from driver errors', () => {
    expect(databaseFailure({ name: 'TimeoutError' })).toEqual({ category: 'APPLICATION_DEADLINE' });
  });
  it('extracts only safe driver codes and kinds from wrapped Prisma errors', () => {
    expect(
      databaseFailure({ code: 'P2010', meta: { code: '57P01', query: 'sensitive-sentinel' } }),
    ).toEqual({ category: 'CONNECTION_DROPPED', errorCode: '57P01' });
    expect(
      databaseFailure({
        code: 'P2010',
        meta: {
          driverAdapterError: { cause: { kind: 'SocketTimeout', host: 'private-sentinel' } },
        },
      }),
    ).toEqual({ category: 'TIMEOUT', errorCode: 'P2010' });
  });
  it('does not expose arbitrary error fields, error codes or strings', () => {
    expect(
      databaseFailure({ code: 'arbitrary-private-value', message: 'sensitive-sentinel' }),
    ).toEqual({ category: 'DATABASE_ERROR' });
    expect(databaseFailure(null)).toEqual({ category: 'DATABASE_ERROR' });
    expect(databaseFailure('private-sentinel')).toEqual({ category: 'DATABASE_ERROR' });
  });
});
