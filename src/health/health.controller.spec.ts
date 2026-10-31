import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReadinessObservation } from '../prisma/database-diagnostics';
import { HealthController } from './health.controller';

describe('Readiness diagnostics preserve the health contract and deadline', () => {
  const request = { id: 'readiness-fixture-request' } as Request;
  const snapshot = { initialized: true, total: 1, idle: 0, waiting: 0, connectionsEstablished: 1 };
  let observeReadiness: jest.Mock;
  let controller: HealthController;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    observeReadiness = jest.fn((observation: ReadinessObservation) => {
      observation.phase = 'complete';
      return Promise.resolve();
    });
    controller = new HealthController({
      readiness: () => {
        const observation: ReadinessObservation = { phase: 'initialize' };
        return { work: observeReadiness(observation), observation };
      },
      poolSnapshot: () => snapshot,
    } as unknown as PrismaService);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it('returns only status ok when the real query succeeds', async () => {
    expect(await controller.ready(request)).toEqual({ status: 'ok' });
    expect(observeReadiness).toHaveBeenCalledTimes(1);
    expect(controller.live()).toEqual({ status: 'ok' });
  });
  it('returns a meaningful 503 and logs only safe diagnostics when the database fails', async () => {
    observeReadiness.mockRejectedValueOnce({ code: 'ECONNRESET', message: 'sensitive-sentinel' });
    await expect(controller.ready(request)).rejects.toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'database_readiness_failed',
        category: 'CONNECTION_DROPPED',
        errorCode: 'ECONNRESET',
        requestId: request.id,
        pool: snapshot,
      }),
      expect.any(String),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-sentinel');
  });
  it('keeps the 2000ms deadline and observes late completion', async () => {
    let complete!: () => void;
    observeReadiness.mockImplementationOnce(async (observation: ReadinessObservation) => {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      observation.initializeMs = 2200;
      observation.phase = 'complete';
    });
    const response = controller.ready(request);
    const asserted = expect(response).rejects.toMatchObject({ status: 503 });
    await jest.advanceTimersByTimeAsync(1999);
    expect(warn).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await asserted;
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'database_readiness_failed',
        phase: 'initialize',
        category: 'APPLICATION_DEADLINE',
      }),
      expect.any(String),
    );
    complete();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'database_readiness_late_completion',
        initializeMs: 2200,
        phase: 'complete',
      }),
      expect.any(String),
    );
  });
  it('records a late underlying failure without an unhandled rejection or sensitive values', async () => {
    let fail!: (reason: unknown) => void;
    observeReadiness.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    const response = controller.ready(request);
    const asserted = expect(response).rejects.toMatchObject({ status: 503 });
    await jest.advanceTimersByTimeAsync(2000);
    await asserted;
    fail({ code: 'P1001', message: 'sensitive-sentinel' });
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'database_readiness_late_failure',
        errorCode: 'P1001',
        category: 'CONNECTION_UNAVAILABLE',
      }),
      expect.any(String),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sensitive-sentinel');
  });
});
