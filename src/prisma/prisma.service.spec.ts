import type { AppConfig } from '../config/app-config';
import { PrismaService } from './prisma.service';

describe('Prisma readiness phase observation', () => {
  it('keeps initialization before the real query and measures both', async () => {
    const service = new PrismaService({
      database: { url: 'postgresql://localhost/diagnostics_test', poolMax: 10 },
    } as AppConfig);
    const initialize = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    const query = jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);
    const observation: {
      phase: 'initialize' | 'query' | 'complete';
      initializeMs?: number;
      queryMs?: number;
    } = { phase: 'initialize' };
    await service.observeReadiness(observation);
    expect(initialize.mock.invocationCallOrder[0]).toBeLessThan(query.mock.invocationCallOrder[0]!);
    expect(observation).toMatchObject({
      phase: 'complete',
      initializeMs: expect.any(Number),
      queryMs: expect.any(Number),
    });
    expect(service.poolSnapshot()).toEqual({
      initialized: false,
      total: 0,
      idle: 0,
      waiting: 0,
      connectionsEstablished: 0,
    });
  });
});
