/**
 * Integration tests wipe this database. The name must end with "_test" so the suite can never
 * be pointed at development, staging or production data by mistake.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://multipleride:multipleride_dev_password@localhost:5433/multipleride_test';

/** Login role that receives exactly the production grants from prisma/sql/02-app-grants.sql. */
export const RESTRICTED_ROLE = 'mr_app_test';
const RESTRICTED_PASSWORD = 'mr_app_test_password';

export function assertTestDatabase(url: string): string {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${name}": the database name must end with _test`,
    );
  }
  return name;
}

export function restrictedDatabaseUrl(): string {
  const url = new URL(TEST_DATABASE_URL);
  url.username = RESTRICTED_ROLE;
  url.password = RESTRICTED_PASSWORD;
  return url.toString();
}

export const restrictedRolePassword = RESTRICTED_PASSWORD;
