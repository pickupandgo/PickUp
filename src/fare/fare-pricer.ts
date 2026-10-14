import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { PricingVersion } from '../generated/prisma/client';
import type { CreateFareQuoteRequest } from './fare.dto';
import { type Coordinates, haversineMeters, normalizeCoordinates } from './pricing/geo';
import { UnpricedCategoryError } from './pricing/leg-distance-v1';
import { priceRoute } from './pricing/price-route';
import { type PricingConfig, pricedCategories } from './pricing/pricing-config';

/** Razorpay's limits for one order (Rs 1 to Rs 5,00,000); a quote must be payable at once. */
export const MIN_PAYABLE_PAISE = 100n;
export const MAX_PAYABLE_PAISE = 50_000_000n;

export interface PricedQuoteDrop {
  readonly sequence: number;
  readonly location: Coordinates;
  readonly distanceMeters: number;
  readonly farePaise: bigint;
  readonly taxPaise: bigint;
  readonly payablePaise: bigint;
}

export interface PricedQuote {
  readonly version: PricingVersion;
  readonly vehicleCategory: string;
  readonly weightGrams: number;
  readonly pickup: Coordinates;
  readonly distanceMeters: number;
  readonly farePaise: bigint;
  readonly taxPaise: bigint;
  readonly payablePaise: bigint;
  readonly drops: readonly PricedQuoteDrop[];
}

/**
 * Turns a route request into priced drops under one pricing version. Everything an app sends is
 * a location, a vehicle category or a weight; every amount comes from here.
 */
@Injectable()
export class FarePricer {
  price(
    version: PricingVersion,
    pricing: PricingConfig,
    request: CreateFareQuoteRequest,
  ): PricedQuote {
    const vehicleCategory = request.vehicleCategory;
    if (!pricing.config.vehicles[vehicleCategory]) {
      throw unpriced(vehicleCategory, pricing);
    }
    const weightGrams = Math.round(request.weightKg * 1000);
    if (!Number.isSafeInteger(weightGrams) || weightGrams < 1) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        HttpStatus.BAD_REQUEST,
        'weightKg is invalid',
      );
    }

    const pickup = normalizeCoordinates(request.pickup);
    const drops = request.drops.map(normalizeCoordinates);
    const legs = drops.map((drop, index) => haversineMeters(drops[index - 1] ?? pickup, drop));

    let priced;
    try {
      priced = priceRoute(pricing, { vehicleCategory, weightGrams, legDistancesMeters: legs });
    } catch (error) {
      if (error instanceof UnpricedCategoryError) {
        throw unpriced(vehicleCategory, pricing);
      }
      throw error;
    }

    const pricedDrops = drops.map((location, index): PricedQuoteDrop => {
      const drop = priced[index];
      const distanceMeters = legs[index];
      if (!drop || distanceMeters === undefined) {
        throw new Error('Pricing returned a different number of drops');
      }
      return {
        sequence: index + 1,
        location,
        distanceMeters,
        farePaise: drop.farePaise,
        taxPaise: drop.taxPaise,
        payablePaise: drop.farePaise + drop.taxPaise,
      };
    });
    const farePaise = pricedDrops.reduce((sum, drop) => sum + drop.farePaise, 0n);
    const taxPaise = pricedDrops.reduce((sum, drop) => sum + drop.taxPaise, 0n);
    const payablePaise = farePaise + taxPaise;
    if (payablePaise < MIN_PAYABLE_PAISE || payablePaise > MAX_PAYABLE_PAISE) {
      throw new AppError(
        ErrorCode.AMOUNT_OUT_OF_RANGE,
        HttpStatus.UNPROCESSABLE_ENTITY,
        'This route cannot be booked: its fare is outside the payable range',
        { minPaise: Number(MIN_PAYABLE_PAISE), maxPaise: Number(MAX_PAYABLE_PAISE) },
      );
    }
    return {
      version,
      vehicleCategory,
      weightGrams,
      pickup,
      distanceMeters: legs.reduce((sum, meters) => sum + meters, 0),
      farePaise,
      taxPaise,
      payablePaise,
      drops: pricedDrops,
    };
  }
}

function unpriced(vehicleCategory: string, pricing: PricingConfig): AppError {
  return new AppError(
    ErrorCode.VEHICLE_CATEGORY_NOT_PRICED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    'This vehicle category has no price right now',
    { vehicleCategory, pricedCategories: pricedCategories(pricing) },
  );
}
