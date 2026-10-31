import type { AppConfig } from '../config/app-config';
import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import { inspect } from 'node:util';
import { HealthController } from '../health/health.controller';
import { PrismaService } from './prisma.service';

describe('Prisma readiness phase observation', () => {
  it('keeps initialization before the real query and measures both', async () => {
    const service = new PrismaService({
      database: { url: 'postgresql://localhost/diagnostics_test', poolMax: 10 },
    } as AppConfig);
    const initialize = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    const query = jest.spyOn(service, '$queryRaw').mockResolvedValue([{ '?column?': 1 }]);
    const { work, observation } = service.readiness();
    await work;
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

  afterEach(() => jest.restoreAllMocks());

  it('blocks startup until both Prisma initialization and the real query succeed', async () => {
    const service = new PrismaService({
      database: { url: 'postgresql://localhost/readiness_test', poolMax: 10 },
    } as AppConfig);
    let connect!: () => void;
    let queried!: () => void;
    jest.spyOn(service, '$connect').mockReturnValue(
      new Promise<void>((resolve) => {
        connect = resolve;
      }),
    );
    jest.spyOn(service, '$queryRaw').mockReturnValue(
      new Promise((resolve) => {
        queried = () => resolve([]);
      }) as ReturnType<typeof service.$queryRaw>,
    );
    let started = false;
    const initializing = service.onModuleInit().then(() => {
      started = true;
    });
    await Promise.resolve();
    expect(started).toBe(false);
    connect();
    await Promise.resolve();
    expect(service.$queryRaw).toHaveBeenCalledTimes(1);
    expect(started).toBe(false);
    queried();
    await initializing;
    expect(started).toBe(true);
  });

  it('fails startup closed with a sanitized error if the database cannot serve a query', async () => {
    const service = new PrismaService({
      database: { url: 'postgresql://localhost/readiness_test', poolMax: 10 },
    } as AppConfig);
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    jest
      .spyOn(service, '$queryRaw')
      .mockRejectedValue({ code: 'ECONNREFUSED', message: 'sensitive-sentinel' });
    const failure: unknown = await service.onModuleInit().catch((error: unknown) => error);
    expect(failure).toMatchObject({
      message: 'Database initialization failed',
      cause: { category: 'CONNECTION_UNAVAILABLE', errorCode: 'ECONNREFUSED' },
    });
    expect(inspect(failure)).not.toContain('sensitive-sentinel');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'database_initialization_failed',
        category: 'CONNECTION_UNAVAILABLE',
        errorCode: 'ECONNREFUSED',
      }),
      expect.any(String),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('sensitive-sentinel');
  });

  it('shares in-flight work and permits a fresh check after transient failure and recovery', async () => {
    const service = new PrismaService({
      database: { url: 'postgresql://localhost/readiness_test', poolMax: 10 },
    } as AppConfig);
    jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    let fail!: (reason: unknown) => void;
    jest
      .spyOn(service, '$queryRaw')
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          fail = reject;
        }) as ReturnType<typeof service.$queryRaw>,
      )
      .mockResolvedValue([]);
    const first = service.readiness();
    const failed = expect(first.work).rejects.toMatchObject({ code: 'ECONNRESET' });
    await Promise.resolve();
    for (let n = 0; n < 20; n++) expect(service.readiness()).toBe(first);
    expect(service.$queryRaw).toHaveBeenCalledTimes(1);
    fail({ code: 'ECONNRESET' });
    await failed;
    const recovery = service.readiness();
    expect(recovery).not.toBe(first);
    await recovery.work;
    expect(service.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps one probe after HTTP deadlines and recovers when the underlying query completes', async () => {
    jest.useFakeTimers();
    try {
      const service = new PrismaService({
        database: { url: 'postgresql://localhost/readiness_test', poolMax: 10 },
      } as AppConfig);
      jest.spyOn(service, '$connect').mockResolvedValue(undefined);
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      let finish!: () => void;
      jest
        .spyOn(service, '$queryRaw')
        .mockReturnValueOnce(
          new Promise((resolve) => {
            finish = () => resolve([]);
          }) as ReturnType<typeof service.$queryRaw>,
        )
        .mockResolvedValue([]);
      const controller = new HealthController(service);
      const request = { id: 'shared-readiness-fixture' } as Request;
      const first = service.readiness();
      const initial = Array.from({ length: 10 }, () =>
        expect(controller.ready(request)).rejects.toMatchObject({ status: 503 }),
      );
      await jest.advanceTimersByTimeAsync(2000);
      await Promise.all(initial);
      expect(service.readiness()).toBe(first);
      const repeated = expect(controller.ready(request)).rejects.toMatchObject({ status: 503 });
      await jest.advanceTimersByTimeAsync(2000);
      await repeated;
      expect(service.$queryRaw).toHaveBeenCalledTimes(1);
      finish();
      await first.work;
      expect(await controller.ready(request)).toEqual({ status: 'ok' });
      expect(service.$queryRaw).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
