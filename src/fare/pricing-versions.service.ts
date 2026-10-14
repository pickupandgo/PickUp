import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { recordAdminAction } from '../audit/admin-actions';
import type { Principal } from '../auth/principal';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { PricingVersion } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateFareQuoteRequest } from './fare.dto';
import { FarePricer, type PricedQuote } from './fare-pricer';
import { parsePricingConfig } from './pricing/pricing-config';
import {
  type CreatePricingVersionResult,
  createPricingVersionRecord,
  findPricingVersionInEffect,
} from './pricing-versions';

/** Admin operations on pricing versions. Versions are created and closed, never edited. */
@Injectable()
export class PricingVersionsService {
  private readonly logger = new Logger(PricingVersionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricer: FarePricer,
    private readonly clock: Clock,
  ) {}

  now(): Date {
    return this.clock.now();
  }

  async create(
    admin: Principal,
    input: {
      readonly code: string;
      readonly model: string;
      readonly config: unknown;
      readonly effectiveFrom: Date | null;
      readonly reason: string;
    },
  ): Promise<CreatePricingVersionResult> {
    const result = await createPricingVersionRecord(
      this.prisma,
      { ...input, createdByUserId: admin.userId },
      this.clock.now(),
    );
    this.logger.log(
      {
        pricingVersionId: result.version.id,
        code: result.version.code,
        supersededVersionId: result.superseded?.id ?? null,
        adminUserId: admin.userId,
      },
      'Pricing version created',
    );
    return result;
  }

  list(options: { readonly activeOnly: boolean }): Promise<PricingVersion[]> {
    return this.prisma.pricingVersion.findMany({
      where: options.activeOnly ? { active: true } : {},
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async get(versionId: string): Promise<PricingVersion> {
    const version = await this.prisma.pricingVersion.findUnique({ where: { id: versionId } });
    if (!version) {
      throw notFound();
    }
    return version;
  }

  /** The version pricing new quotes now. */
  async current(): Promise<PricingVersion> {
    const inEffect = await findPricingVersionInEffect(this.prisma, this.clock.now());
    if (!inEffect) {
      throw new AppError(
        ErrorCode.PRICING_NOT_CONFIGURED,
        HttpStatus.NOT_FOUND,
        'No pricing version is in effect',
      );
    }
    return inEffect.version;
  }

  /** What a route would cost under a given version (in effect or not); nothing is stored. */
  async preview(versionId: string, request: CreateFareQuoteRequest): Promise<PricedQuote> {
    const version = await this.get(versionId);
    return this.pricer.price(version, parsePricingConfig(version.model, version.config), request);
  }

  /** Kill switch for a version created by mistake. Idempotent. Quotes already given keep it. */
  async deactivate(admin: Principal, versionId: string, reason: string): Promise<PricingVersion> {
    return this.prisma.runInTransaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string; active: boolean }[]>`
        SELECT id, active FROM pricing_versions WHERE id = ${versionId}::uuid FOR UPDATE`;
      if (!locked) {
        throw notFound();
      }
      if (!locked.active) {
        return tx.pricingVersion.findUniqueOrThrow({ where: { id: versionId } });
      }
      const version = await tx.pricingVersion.update({
        where: { id: versionId },
        data: {
          active: false,
          deactivatedAt: this.clock.now(),
          deactivatedByUserId: admin.userId,
          deactivationReason: reason,
        },
      });
      await recordAdminAction(tx, {
        actorUserId: admin.userId,
        action: 'PRICING_VERSION_DEACTIVATED',
        targetType: 'PRICING_VERSION',
        targetId: versionId,
        reason,
      });
      return version;
    });
  }
}

function notFound(): AppError {
  return new AppError(
    ErrorCode.PRICING_VERSION_NOT_FOUND,
    HttpStatus.NOT_FOUND,
    'Pricing version not found',
  );
}
