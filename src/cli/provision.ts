import { existsSync } from 'node:fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppError } from '../common/errors/app-error';
import { PrismaClient } from '../generated/prisma/client';
import { PROVISION_USAGE, parseProvisionArgs, ProvisionUsageError } from './provision-args';
import { runProvisionCommand } from './provision-commands';

/** Ops CLI: creates test drivers/admins linked to a Firebase UID. See PROVISION_USAGE. */
async function main(): Promise<number> {
  if (process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL && existsSync('.env')) {
    process.loadEnvFile('.env');
  }

  let command;
  try {
    command = parseProvisionArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ProvisionUsageError) {
      console.error(`${error.message}\n\n${PROVISION_USAGE}`);
      return 2;
    }
    throw error;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    return 2;
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) });
  try {
    const result = await runProvisionCommand(
      prisma,
      process.env.AUTH_PROVIDER ?? 'firebase',
      command,
    );
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    if (error instanceof ProvisionUsageError || error instanceof AppError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('Provisioning failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
