import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Principal } from '../auth/principal';
import { requireCustomer } from '../auth/require-driver';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateFareQuoteRequest,
  FareQuoteResponse,
  InternalFareQuoteResponse,
} from './fare.dto';
import { toFareQuoteResponse, type QuoteWithStops } from './fare.mapper';
import { FarePricer } from './fare-pricer';
import { coordinateText } from './pricing/geo';
import { findPricingVersionInEffect } from './pricing-versions';

const QUOTE_INCLUDE = {
  stops: { orderBy: { sequence: 'asc' } },
  pricingVersion: { select: { id: true, code: true } },
} as const;

/**
 * Fare quotes for customers. The price is calculated here from the pricing version in effect,
 * stored with every per-drop amount, and returned with an expiry. A booking can only be
 * registered from an unexpired, unused quote of the same customer (FareQuoteRedeemer).
 */
@Injectable()
export class FareQuotesService {
  private readonly logger = new Logger(FareQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pricer: FarePricer,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(principal: Principal, request: CreateFareQuoteRequest): Promise<FareQuoteResponse> {
    const customer = requireCustomer(principal);
    const maxDrops = this.config.fare.maxDrops;
    if (request.drops.length > maxDrops) {
      throw new AppError(
        ErrorCode.TOO_MANY_DROPS,
        HttpStatus.UNPROCESSABLE_ENTITY,
        `A booking can have at most ${maxDrops} drops`,
        { maxDrops },
      );
    }
    const now = this.clock.now();
    const inEffect = await findPricingVersionInEffect(this.prisma, now);
    if (!inEffect) {
      throw new AppError(
        ErrorCode.PRICING_NOT_CONFIGURED,
        HttpStatus.SERVICE_UNAVAILABLE,
        'Fares are not available right now. Please try again later',
      );
    }
    const priced = this.pricer.price(inEffect.version, inEffect.pricing, request);
    const expiresAt = new Date(now.getTime() + this.config.fare.quoteTtlSeconds * 1000);

    const quote = await this.prisma.runInTransaction(async (tx) => {
      const created = await tx.fareQuote.create({
        data: {
          customerId: customer.id,
          pricingVersionId: priced.version.id,
          vehicleCategory: priced.vehicleCategory,
          weightGrams: priced.weightGrams,
          pickupLatitude: coordinateText(priced.pickup.latitude),
          pickupLongitude: coordinateText(priced.pickup.longitude),
          distanceMeters: priced.distanceMeters,
          farePaise: priced.farePaise,
          taxPaise: priced.taxPaise,
          payablePaise: priced.payablePaise,
          expiresAt,
          createdAt: now,
        },
      });
      await tx.fareQuoteStop.createMany({
        data: priced.drops.map((drop) => ({
          quoteId: created.id,
          sequence: drop.sequence,
          latitude: coordinateText(drop.location.latitude),
          longitude: coordinateText(drop.location.longitude),
          distanceMeters: drop.distanceMeters,
          farePaise: drop.farePaise,
          taxPaise: drop.taxPaise,
          payablePaise: drop.payablePaise,
        })),
      });
      return tx.fareQuote.findUniqueOrThrow({ where: { id: created.id }, include: QUOTE_INCLUDE });
    });
    this.logger.log(
      {
        quoteId: quote.id,
        pricingVersionId: priced.version.id,
        drops: priced.drops.length,
        payablePaise: Number(priced.payablePaise),
      },
      'Fare quoted',
    );
    return toFareQuoteResponse(quote);
  }

  /** The customer's own quote; another customer's quote behaves like a missing one. */
  async get(principal: Principal, quoteId: string): Promise<FareQuoteResponse> {
    const customer = requireCustomer(principal);
    const quote = await this.prisma.fareQuote.findFirst({
      where: { id: quoteId, customerId: customer.id },
      include: QUOTE_INCLUDE,
    });
    if (!quote) {
      throw quoteNotFound(HttpStatus.NOT_FOUND);
    }
    return toFareQuoteResponse(quote);
  }

  /** For the trip engine: the priced route, so the trip it runs is the trip that was quoted. */
  async getForEngine(quoteId: string): Promise<InternalFareQuoteResponse> {
    const quote: QuoteWithStops | null = await this.prisma.fareQuote.findUnique({
      where: { id: quoteId },
      include: QUOTE_INCLUDE,
    });
    if (!quote) {
      throw quoteNotFound(HttpStatus.NOT_FOUND);
    }
    return { ...toFareQuoteResponse(quote), customerId: quote.customerId };
  }
}

export function quoteNotFound(status: HttpStatus): AppError {
  return new AppError(ErrorCode.QUOTE_NOT_FOUND, status, 'Fare quote not found');
}
