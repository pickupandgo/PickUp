/**
 * Integration tests wipe this database. The name must end with "_test" so the suite can never
 * be pointed at development, staging or production data by mistake. It is the engine's own
 * database: the payment backend is replaced by an in-process fake (helpers/fake-payment-backend).
 */
export const TEST_DATABASE_URL =
  process.env.ENGINE_TEST_DATABASE_URL ??
  'postgresql://multipleride:multipleride_dev_password@localhost:5433/multipleride_engine_test';

export function assertTestDatabase(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Refusing to run integration tests against "${name}": the database name must end with _test`,
    );
  }
  return name;
}
