import { Controller, Get, HttpStatus, Logger, Req, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { performance } from 'node:perf_hooks';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { withTimeout, TimeoutError } from '../common/async';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import { databaseFailure, type ReadinessObservation } from '../prisma/database-diagnostics';

export class HealthStatusResponse {
  /** Always "ok" when the check passes. */
  status!: 'ok';
}

/** Public probes reveal no hosts, versions, timings or internal failure details. */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live(): HealthStatusResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Req() request: Request): Promise<HealthStatusResponse> {
    const started = performance.now();
    const observation: ReadinessObservation = { phase: 'initialize' };
    let expired = false;
    const details = () => ({
      requestId: request.id,
      durationMs: Math.round(performance.now() - started),
      ...observation,
      pool: this.prisma.poolSnapshot(),
    });
    const query = this.prisma.observeReadiness(observation);
    // Observe late completion rather than losing the cause behind a generic 503.
    // This diagnostic release intentionally keeps the pre-existing timeout behavior.
    void query.then(
      () => {
        if (expired)
          this.logger.warn(
            {
              event: 'database_readiness_late_completion',
              ...details(),
            },
            'Database readiness work completed after the deadline',
          );
      },
      (error) => {
        if (expired)
          this.logger.warn(
            {
              event: 'database_readiness_late_failure',
              ...details(),
              ...databaseFailure(error),
            },
            'Database readiness work failed after the deadline',
          );
      },
    );
    try {
      await withTimeout(query, 2_000);
      if (performance.now() - started >= 1_000)
        this.logger.warn(
          {
            event: 'database_readiness_slow',
            ...details(),
          },
          'Database readiness was slow',
        );
      return { status: 'ok' };
    } catch (error) {
      expired = error instanceof TimeoutError;
      this.logger.warn(
        {
          event: 'database_readiness_failed',
          ...details(),
          ...databaseFailure(error),
        },
        'Database readiness failed',
      );
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Service is not ready',
      );
    }
  }
}
