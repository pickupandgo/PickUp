-- Least-privilege database roles for the MultipleRide backend.
--
-- Run ONCE per database, as an administrator, BEFORE the first migration:
--   psql "<admin connection url>" \
--        -v db_name=multipleride \
--        -v migrator_password='<strong random password>' \
--        -v app_password='<different strong random password>' \
--        -f prisma/sql/01-roles.sql
--
-- Roles:
--   mr_migrator  owns the schema objects. Used only to run migrations and ops tooling.
--   mr_app       used by the running API. Can never DELETE or TRUNCATE, can only INSERT into the
--                wallet ledger, and can only UPDATE the specific columns the service changes.
--
-- After running this file:
--   1. Run migrations as mr_migrator:     DATABASE_URL=<mr_migrator url> npx prisma migrate deploy
--   2. Apply grants as mr_migrator:       psql "<mr_migrator url>" -f prisma/sql/02-app-grants.sql
--   3. Start the API with:                DATABASE_URL=<mr_app url>

\set ON_ERROR_STOP on

CREATE ROLE mr_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE mr_app LOGIN PASSWORD :'app_password' CONNECTION LIMIT 50;

GRANT CONNECT ON DATABASE :"db_name" TO mr_migrator, mr_app;

-- Only the migrator may create objects in the public schema.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO mr_migrator;
GRANT USAGE ON SCHEMA public TO mr_app;
