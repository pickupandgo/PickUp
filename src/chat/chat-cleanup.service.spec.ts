import { ChatCleanupService } from './chat-cleanup.service';
import type { ChatService } from './chat.service';
import type { AppConfig } from '../config/app-config';

describe('ChatCleanupService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  function setup(nodeEnv = 'production') {
    const purgeClosedConversations = jest.fn().mockResolvedValue(0);
    const worker = new ChatCleanupService(
      { purgeClosedConversations } as unknown as ChatService,
      { nodeEnv } as AppConfig,
    );
    return { worker, purgeClosedConversations };
  }
  it('does not run cleanup automatically in isolated application tests', async () => {
    const { worker, purgeClosedConversations } = setup('test');
    worker.onModuleInit();
    jest.advanceTimersByTime(120000);
    expect(purgeClosedConversations).not.toHaveBeenCalled();
    await worker.onModuleDestroy();
  });
  it('bounds each tick to three batches and retries failures on the next tick', async () => {
    const { worker, purgeClosedConversations } = setup();
    purgeClosedConversations.mockResolvedValue(100);
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(0);
    expect(purgeClosedConversations).toHaveBeenCalledTimes(3);
    purgeClosedConversations.mockRejectedValueOnce(new Error('database unavailable'));
    await jest.advanceTimersByTimeAsync(60000);
    expect(purgeClosedConversations).toHaveBeenCalledTimes(4);
    purgeClosedConversations.mockResolvedValue(0);
    await jest.advanceTimersByTimeAsync(60000);
    expect(purgeClosedConversations).toHaveBeenCalledTimes(5);
    await worker.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(60000);
    expect(purgeClosedConversations).toHaveBeenCalledTimes(5);
  });
  it('does not overlap cleanup when a previous database call is delayed', async () => {
    const { worker, purgeClosedConversations } = setup();
    let finish!: (count: number) => void;
    purgeClosedConversations.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    worker.onModuleInit();
    await jest.advanceTimersByTimeAsync(120000);
    expect(purgeClosedConversations).toHaveBeenCalledTimes(1);
    finish(0);
    await worker.onModuleDestroy();
  });
});
