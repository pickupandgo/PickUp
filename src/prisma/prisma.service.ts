import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { performance } from 'node:perf_hooks';
import type { Pool } from 'pg';
import { databaseFailure, type ReadinessObservation } from './database-diagnostics';
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
  private readonly observedPool: () => Pool | undefined;
  private readonly connectedCount: () => number;

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
        onPoolError: (error) =>
          logger.error(databaseFailure(error), 'Idle database connection failed'),
        onConnectionError: (error) =>
          logger.warn(databaseFailure(error), 'Database connection failed'),
      },
    );
    // Observe the existing adapter-owned pool; no second pool or setting changes.
    let pool: Pool | undefined;
    let connections = 0;
    const connect = adapter.connect.bind(adapter);
    adapter.connect = async () => {
      const driver = await connect();
      pool = driver.underlyingDriver();
      pool.on('connect', () => {
        connections++;
      });
      return driver;
    };
    // Minimal messages keep query arguments (phone numbers, ids) out of error logs.
    super({ adapter, errorFormat: 'minimal' });
    this.observedPool = () => pool;
    this.connectedCount = () => connections;
  }

  /** Same lazy connect + SELECT as before; the caller's existing deadline covers both. */
  async observeReadiness(observation: ReadinessObservation): Promise<void> {
    const initializeStarted = performance.now();
    observation.phase = 'initialize';
    await this.$connect();
    observation.initializeMs = Math.round(performance.now() - initializeStarted);
    observation.phase = 'query';
    const queryStarted = performance.now();
    try {
      await this.$queryRaw`SELECT 1`;
    } finally {
      observation.queryMs = Math.round(performance.now() - queryStarted);
    }
    observation.phase = 'complete';
  }

  poolSnapshot() {
    const pool = this.observedPool();
    return {
      initialized: !!pool,
      total: pool?.totalCount ?? 0,
      idle: pool?.idleCount ?? 0,
      waiting: pool?.waitingCount ?? 0,
      connectionsEstablished: this.connectedCount(),
    };
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
