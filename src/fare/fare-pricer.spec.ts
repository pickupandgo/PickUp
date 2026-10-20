import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { PricingVersion } from '../generated/prisma/client';
import type { CreateFareQuoteRequest } from './fare.dto';
import { FarePricer, MAX_PAYABLE_PAISE, MIN_PAYABLE_PAISE } from './fare-pricer';
import { parsePricingConfig } from './pricing/pricing-config';

const VERSION = { id: 'version-1', code: 'TEST-1' } as PricingVersion;

const pricing = (overrides: Record<string, unknown> = {}) =>
  parsePricingConfig('LEG_DISTANCE_V1', {
    currency: 'INR',
    distanceModel: 'HAVERSINE',
    vehicles: {
      MINI_TRUCK: {
        firstLegBasePaise: 3000,
        additionalLegBasePaise: 1000,
        perKmPaise: 1200,
        minimumLegFarePaise: 100,
      },
    },
    weightBands: [{ upToGrams: null, multiplierBps: 10_000 }],
    legRounding: { incrementPaise: 100, mode: 'UP' },
    taxes: [],
    ...overrides,
  });

/** Pickup in Jodhpur, then two drops roughly 11.8 km and 4 km further on. */
const REQUEST: CreateFareQuoteRequest = {
  pickup: { latitude: 26.2389, longitude: 73.0243 },
  drops: [
    { latitude: 26.3448, longitude: 73.0458 },
    { latitude: 26.3448, longitude: 73.0858 },
  ],
  vehicleCategory: 'MINI_TRUCK',
  weightKg: 12.5,
};

describe('FarePricer', () => {
  const pricer = new FarePricer();

  it('prices every drop, and the booking total is exactly the sum of the drops', () => {
    const quote = pricer.price(VERSION, pricing(), REQUEST);
    expect(quote.drops).toHaveLength(2);
    expect(quote.drops.map((drop) => drop.sequence)).toEqual([1, 2]);
    expect(quote.farePaise).toBe(quote.drops.reduce((sum, drop) => sum + drop.farePaise, 0n));
    expect(quote.payablePaise).toBe(quote.farePaise + quote.taxPaise);
    for (const drop of quote.drops) {
      expect(drop.payablePaise).toBe(drop.farePaise + drop.taxPaise);
    }
    expect(quote.distanceMeters).toBe(
      quote.drops.reduce((sum, drop) => sum + drop.distanceMeters, 0),
    );
    expect(quote.version).toBe(VERSION);
  });

  it('measures each leg from the previous stop, not from the pickup', () => {
    const quote = pricer.price(VERSION, pricing(), REQUEST);
    const [first, second] = quote.drops;
    // The second drop is much closer to the first drop than to the pickup.
    expect(first?.distanceMeters).toBeGreaterThan(11_000);
    expect(second?.distanceMeters).toBeLessThan(5_000);
  });

  it('converts weight to whole grams and stores the normalized coordinates', () => {
    const quote = pricer.price(VERSION, pricing(), {
      ...REQUEST,
      weightKg: 12.345,
      pickup: { latitude: 26.23891234, longitude: 73.02430005 },
    });
    expect(quote.weightGrams).toBe(12_345);
    expect(quote.pickup).toEqual({ latitude: 26.238912, longitude: 73.0243 });
  });

  it('refuses a vehicle category the version does not price, and says which it does', () => {
    try {
      pricer.price(VERSION, pricing(), { ...REQUEST, vehicleCategory: 'JCB' });
      throw new Error('Expected the quote to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe(ErrorCode.VEHICLE_CATEGORY_NOT_PRICED);
      expect(appError.status).toBe(422);
      expect(appError.details).toEqual({
        vehicleCategory: 'JCB',
        pricedCategories: ['MINI_TRUCK'],
      });
    }
  });

  it('refuses a route whose fare is below Razorpay\u2019s minimum of Rs 1', () => {
    const free = pricing({
      vehicles: {
        MINI_TRUCK: {
          firstLegBasePaise: 0,
          additionalLegBasePaise: 0,
          perKmPaise: 0,
          minimumLegFarePaise: 100,
        },
      },
      legRounding: { incrementPaise: 1, mode: 'DOWN' },
    });
    // One drop at the pickup: 0 paise before the minimum, 100 paise after it.
    const atMinimum = pricer.price(VERSION, free, {
      ...REQUEST,
      drops: [REQUEST.pickup],
    });
    expect(atMinimum.payablePaise).toBe(MIN_PAYABLE_PAISE);
  });

  it('refuses a route whose fare is above Razorpay\u2019s per-order maximum', () => {
    const expensive = pricing({
      vehicles: {
        MINI_TRUCK: {
          firstLegBasePaise: 50_000_000,
          additionalLegBasePaise: 50_000_000,
          perKmPaise: 0,
          minimumLegFarePaise: 100,
        },
      },
    });
    try {
      pricer.price(VERSION, expensive, REQUEST);
      throw new Error('Expected the quote to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.AMOUNT_OUT_OF_RANGE);
      expect((error as AppError).details).toEqual({
        minPaise: Number(MIN_PAYABLE_PAISE),
        maxPaise: Number(MAX_PAYABLE_PAISE),
      });
    }
  });

  it('refuses a weight that is not a usable whole number of grams', () => {
    for (const weightKg of [0.0001, Number.NaN]) {
      expect(() => pricer.price(VERSION, pricing(), { ...REQUEST, weightKg })).toThrow(AppError);
    }
  });

  it('prices the maximum of five drops', () => {
    const drops = Array.from({ length: 5 }, (_unused, index) => ({
      latitude: 26.2389 + (index + 1) / 100,
      longitude: 73.0243,
    }));
    const quote = pricer.price(VERSION, pricing(), { ...REQUEST, drops });
    expect(quote.drops).toHaveLength(5);
    expect(quote.farePaise).toBe(quote.drops.reduce((sum, drop) => sum + drop.farePaise, 0n));
  });
});
