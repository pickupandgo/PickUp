import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { describeError } from '../common/errors';
import { ENGINE_CONFIG, type EngineConfig } from '../config/engine-config';
import { Prisma, PrismaClient } from '../generated/prisma/client';

const logger = new Logger('PrismaService');

/** Transaction-scoped Prisma client passed to code that must run inside a DB transaction. */
export type Tx = Prisma.TransactionClient;

/**
 * The engine's own database (same pattern as raj_backend). Never connected to the payment
 * backend's database: the engine talks to it only through its internal HTTP API.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(ENGINE_CONFIG) config: EngineConfig) {
    const adapter = new PrismaPg(
      {
        connectionString: config.database.url,
        max: config.database.poolMax,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        // Server-side guards so a stuck statement or abandoned transaction can't hold locks.
        statement_timeout: 15_000,
        idle_in_transaction_session_timeout: 30_000,
        application_name: 'multipleride-engine',
      },
      {
        onPoolError: (error) =>
          logger.error({
            msg: 'Idle database connection failed',
            error: describeError(error),
          }),
        onConnectionError: (error) =>
          logger.warn({
            msg: 'Database connection failed',
            error: describeError(error),
          }),
      },
    );
    super({ adapter, errorFormat: 'minimal' });
  }

  /**
   * Runs `work` in a READ COMMITTED transaction with a bounded lock wait. Callers lock the
   * booking row first (lockBooking) for anything that changes a booking, its trip or its outbox.
   * Never call the payment backend (or any HTTP service) from inside `work`.
   */
  async runInTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('lock_timeout', '5s', true)`;
        return work(tx);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
