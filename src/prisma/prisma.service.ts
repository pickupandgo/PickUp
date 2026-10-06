import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Prisma, PrismaClient } from '../generated/prisma/client';

const logger = new Logger('PrismaService');

/** Transaction-scoped Prisma client passed to code that must run inside a DB transaction. */
export type Tx = Prisma.TransactionClient;

export interface TransactionOptions {
  /** Upper bound for the whole interactive transaction. */
  readonly timeoutMs?: number;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const adapter = new PrismaPg(
      {
        connectionString: config.database.url,
        max: config.database.poolMax,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        // Server-side guards so a stuck statement or abandoned transaction cannot hold locks forever.
        statement_timeout: 15_000,
        idle_in_transaction_session_timeout: 30_000,
        application_name: 'multipleride-backend',
      },
      {
        // Dropped connections (failover, restarts) are retired by the pool; make them visible.
        onPoolError: (error) => logger.error({ err: error }, 'Idle database connection failed'),
        onConnectionError: (error) => logger.warn({ err: error }, 'Database connection failed'),
      },
    );
    // Minimal messages keep query arguments (phone numbers, ids) out of error logs.
    super({ adapter, errorFormat: 'minimal' });
  }

  /**
   * Runs `work` in a READ COMMITTED transaction with a bounded lock wait.
   * Callers take explicit row locks (SELECT ... FOR UPDATE) for anything financial.
   * Never call external services (Razorpay, push, HTTP) from inside `work`.
   */
  async runInTransaction<T>(
    work: (tx: Tx) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        return work(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: options.timeoutMs ?? 15_000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
