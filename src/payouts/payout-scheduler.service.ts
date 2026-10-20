import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Clock } from '../common/clock';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import type { PayoutBatch } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MerchantSettlementsService } from '../settlements/merchant-settlements.service';
import { PayoutBatchesService } from './payout-batches.service';
import { PayoutExecutionService } from './payout-execution.service';
import { isoWeekKey, latestScheduledRun, nextScheduledRun, WEEKDAY_NAMES } from './payout-schedule';

const TICK_MS = 60_000;

export interface PayoutScheduleView {
  readonly enabled: boolean;
  readonly weekday: number;
  readonly weekdayName: string;
  readonly time: string;
  readonly timeZone: string;
  readonly autoExecute: boolean;
  /** The most recent scheduled run at or before now, and its idempotency key. */
  readonly lastRunAt: string;
  readonly lastRunKey: string;
  readonly nextRunAt: string;
}

/**
 * Weekly payout scheduler (OPEN_DECISIONS D-48): every PAYOUT_SCHEDULE_WEEKDAY at
 * PAYOUT_SCHEDULE_TIME in PAYOUT_SCHEDULE_TIMEZONE (approved: Monday 11:00 Asia/Kolkata), when
 * PAYOUT_SCHEDULE_ENABLED. Every minute it checks whether this week's run time has passed and, if
 * so, first pulls the latest merchant settlements, then prepares the week's batch once
 * (idempotency key schedule:<ISO week>, safe with several instances). It executes the batch only
 * when PAYOUT_AUTO_EXECUTE is true; by default an admin reviews and executes it.
 */
@Injectable()
export class PayoutSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PayoutSchedulerService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly batches: PayoutBatchesService,
    private readonly execution: PayoutExecutionService,
    private readonly settlements: MerchantSettlementsService,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const { schedule } = this.config.payouts;
    if (!schedule.enabled) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    this.logger.log(this.view(), 'Weekly payout scheduler started');
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** The effective schedule (system configuration) and the last and next run times. */
  view(now: Date = this.clock.now()): PayoutScheduleView {
    const { schedule } = this.config.payouts;
    const last = latestScheduledRun(now, schedule.weekday, schedule.time, schedule.timeZone);
    return {
      enabled: schedule.enabled,
      weekday: schedule.weekday,
      weekdayName: WEEKDAY_NAMES[schedule.weekday - 1] ?? String(schedule.weekday),
      time: schedule.time,
      timeZone: schedule.timeZone,
      autoExecute: schedule.autoExecute,
      lastRunAt: last.toISOString(),
      lastRunKey: `schedule:${isoWeekKey(last, schedule.timeZone)}`,
      nextRunAt: nextScheduledRun(
        now,
        schedule.weekday,
        schedule.time,
        schedule.timeZone,
      ).toISOString(),
    };
  }

  /** One scheduler pass. Public for tests and ops tooling. Returns this cycle's batch, if any. */
  async tick(): Promise<PayoutBatch | null> {
    const { schedule } = this.config.payouts;
    if (!schedule.enabled || this.running) {
      return null;
    }
    this.running = true;
    try {
      const now = this.clock.now();
      const cutoff = latestScheduledRun(now, schedule.weekday, schedule.time, schedule.timeZone);
      const key = `schedule:${isoWeekKey(cutoff, schedule.timeZone)}`;
      let batch = await this.prisma.payoutBatch.findUnique({ where: { idempotencyKey: key } });
      if (!batch) {
        await this.pullSettlements();
        batch = (
          await this.batches.prepare({
            origin: 'SCHEDULE',
            idempotencyKey: key,
            cutoffAt: cutoff,
            actorUserId: null,
          })
        ).batch;
      }
      if (schedule.autoExecute && batch.status !== 'COMPLETED') {
        await this.execution.executeBatch(batch.id, null);
      }
      return batch;
    } catch (error) {
      this.logger.error({ err: error }, 'Scheduled payout run failed; it will be retried');
      return null;
    } finally {
      this.running = false;
    }
  }

  /**
   * Settlements recorded up to the cutoff make their earnings eligible for this batch. A failed
   * pull is not fatal: unsettled earnings are simply not included (they wait for next week).
   */
  private async pullSettlements(): Promise<void> {
    try {
      await this.settlements.sync({ trigger: 'PRE_BATCH' });
    } catch (error) {
      this.logger.warn(
        { reason: (error as Error).name },
        'Settlement pull before the payout batch failed; unsettled earnings stay excluded',
      );
    }
  }
}
