import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ChatService } from './chat.service';

/** Closed conversations are inaccessible immediately; bounded content cleanup runs each minute. */
@Injectable()
export class ChatCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private work?: Promise<void>;
  private readonly logger = new Logger(ChatCleanupService.name);
  constructor(
    private readonly chat: ChatService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  onModuleInit() {
    if (this.config.nodeEnv === 'test') return;
    this.timer = setInterval(() => this.run(), 60_000);
    this.timer.unref();
    this.run();
  }
  private run() {
    if (this.work) return;
    this.work = (async () => {
      try {
        for (let batch = 0; batch < 3; batch++) {
          if ((await this.chat.purgeClosedConversations()) < 100) break;
        }
      } catch {
        this.logger.warn('Closed chat cleanup failed; it will retry. Chat access remains denied.');
      } finally {
        this.work = undefined;
      }
    })();
  }
  async onModuleDestroy() {
    clearInterval(this.timer);
    await this.work;
  }
}
