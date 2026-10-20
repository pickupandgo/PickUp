import { Controller, Get, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators';
import { withTimeout } from '../common/async';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';

export class HealthStatusResponse {
  /** Always "ok" when the check passes. */
  status!: 'ok';
}

/** Liveness and readiness probes. They reveal nothing about versions, hosts or configuration. */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** The process is running. */
  @Get('live')
  live(): HealthStatusResponse {
    return { status: 'ok' };
  }

  /** The process can serve traffic (database reachable). */
  @Get('ready')
  async ready(): Promise<HealthStatusResponse> {
    try {
      await withTimeout(this.prisma.$queryRaw`SELECT 1`, 2_000);
      return { status: 'ok' };
    } catch {
      throw new AppError(
        ErrorCode.SERVICE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Service is not ready',
      );
    }
  }
}
