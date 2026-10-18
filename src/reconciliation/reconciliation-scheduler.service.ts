import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { type ReconciliationJob, ReconciliationRunsService } from './reconciliation-runs.service';

/**
 * Runs the reconciliation jobs on a timer (payment flow Phase 7):
 *
 *   COLLECTION_RECOVERY  every COLLECTION_RECOVERY_INTERVAL_MINUTES (default 5; 0 = off)
 *   RECONCILIATION       every RECONCILIATION_INTERVAL_MINUTES (default 60; 0 = off)
 *
 * A tick that finds a run of its job in progress (on this instance or another) does nothing;
 * the run's lease in the database decides. An admin can start either job at any time.
 */
@Injectable()
export class ReconciliationSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationSchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private readonly running = new Set<ReconciliationJob>();

  constructor(
    private readonly runs: ReconciliationRunsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.schedule('COLLECTION_RECOVERY', this.config.reconciliation.recoveryIntervalMinutes);
    this.schedule('RECONCILIATION', this.config.reconciliation.intervalMinutes);
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }
  }

  /** One scheduled pass of `job`; never throws. */
  async tick(job: ReconciliationJob): Promise<void> {
    if (this.running.has(job)) {
      return;
    }
    this.running.add(job);
    try {
      const run = await this.runs.runNow(job, { trigger: 'SCHEDULE' });
      if (!run) {
        this.logger.debug({ job }, 'A run of this job is in progress; tick skipped');
      }
    } catch (error) {
      this.logger.error(
        { err: error, job },
        'Scheduled reconciliation run failed; it will be retried',
      );
    } finally {
      this.running.delete(job);
    }
  }

  private schedule(job: ReconciliationJob, minutes: number): void {
    if (minutes === 0) {
      this.logger.log({ job }, 'Scheduled runs are off; an admin can start a run');
      return;
    }
    const timer = setInterval(() => void this.tick(job), minutes * 60_000);
    timer.unref();
    this.timers.push(timer);
    this.logger.log({ job, intervalMinutes: minutes }, 'Reconciliation job scheduled');
  }
}
