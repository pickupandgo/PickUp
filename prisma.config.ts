import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not read .env on its own. For local CLI use, load it only when DATABASE_URL
// is not already set, so explicit environment values (CI, tests, production) always win.
if (!process.env.DATABASE_URL && existsSync('.env')) {
  process.loadEnvFile('.env');
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  // `prisma generate` (part of every build) never connects, so builds need no database
  // credentials. Commands that do connect (migrate deploy/status) fail clearly without it.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
