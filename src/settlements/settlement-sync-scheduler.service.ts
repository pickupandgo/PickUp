import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { MerchantSettlementsService } from './merchant-settlements.service';

/**
 * Periodic merchant-settlement pull (SETTLEMENT_SYNC_INTERVAL_MINUTES, default 60; 0 = off).
 * Each pass re-reads the look-back window, so a missed webhook or a restart never loses a
 * settlement; recording is idempotent, so overlapping passes on several instances are safe.
 */
@Injectable()
export class SettlementSyncSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SettlementSyncSchedulerService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly settlements: MerchantSettlementsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const minutes = this.config.settlements.syncIntervalMinutes;
    if (!this.settlements.enabled || minutes === 0) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    this.timer.unref();
    this.logger.log(
      { intervalMinutes: minutes, lookbackDays: this.config.settlements.lookbackDays },
      'Merchant settlement sync started',
    );
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      await this.settlements.sync({ trigger: 'SCHEDULE' });
    } catch (error) {
      this.logger.error({ err: error }, 'Merchant settlement sync failed; it will be retried');
    } finally {
      this.running = false;
    }
  }
}
