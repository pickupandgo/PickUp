import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ErrorCode } from '../../common/errors/error-codes';
import { AppError } from '../../common/errors/app-error';
import { EARTH_RADIUS_METERS, coordinateText, haversineMeters, normalizeCoordinate } from './geo';
import { priceLegDistanceV1, roundToIncrement, UnpricedCategoryError } from './leg-distance-v1';
import {
  type LegDistanceV1Config,
  legDistanceV1Config,
  parsePricingConfig,
  pricedCategories,
} from './pricing-config';

/** A deliberately awkward config: Rs 30 base, Rs 10 extra stop, Rs 12/km, rounded up to rupees. */
const CONFIG: LegDistanceV1Config = legDistanceV1Config.parse({
  currency: 'INR',
  distanceModel: 'HAVERSINE',
  vehicles: {
    MINI_TRUCK: {
      firstLegBasePaise: 3000,
      additionalLegBasePaise: 1000,
      perKmPaise: 1200,
      minimumLegFarePaise: 100,
    },
    SMALL: {
      firstLegBasePaise: 0,
      additionalLegBasePaise: 0,
      perKmPaise: 1,
      minimumLegFarePaise: 500,
    },
  },
  weightBands: [
    { upToGrams: 5_000, multiplierBps: 10_000 },
    { upToGrams: 10_000, multiplierBps: 12_000 },
    { upToGrams: null, multiplierBps: 30_000 },
  ],
  legRounding: { incrementPaise: 100, mode: 'UP' },
  taxes: [],
});

const route = (
  meters: number[],
  overrides: Partial<Parameters<typeof priceLegDistanceV1>[1]> = {},
) =>
  priceLegDistanceV1(CONFIG, {
    vehicleCategory: 'MINI_TRUCK',
    weightGrams: 1_000,
    legDistancesMeters: meters,
    ...overrides,
  });

describe('roundToIncrement', () => {
  // 1234.5 paise, rounded to whole rupees (increment 100).
  it.each([
    ['UP', 1300n],
    ['HALF_UP', 1200n],
    ['DOWN', 1200n],
  ] as const)('rounds 1234.5 paise %s to %s', (mode, expected) => {
    expect(roundToIncrement(24_690n, 20n, 100n, mode)).toBe(expected);
  });

  it('rounds a value exactly on the half up, and leaves exact multiples alone', () => {
    // 1250 paise is exactly half of a rupee increment.
    expect(roundToIncrement(1_250n, 1n, 100n, 'HALF_UP')).toBe(1_300n);
    expect(roundToIncrement(1_249n, 1n, 100n, 'HALF_UP')).toBe(1_200n);
    for (const mode of ['UP', 'HALF_UP', 'DOWN'] as const) {
      expect(roundToIncrement(1_300n, 1n, 100n, mode)).toBe(1_300n);
    }
  });

  it('keeps exact integer arithmetic far beyond the floating point safe range', () => {
    const huge = 9_007_199_254_740_993n; // 2^53 + 1: not representable as a double
    expect(roundToIncrement(huge, 1n, 1n, 'UP')).toBe(huge);
    expect(roundToIncrement(huge, 1n, 1n, 'DOWN')).toBe(huge);
  });

  it('refuses nonsense input instead of guessing', () => {
    expect(() => roundToIncrement(-1n, 1n, 1n, 'UP')).toThrow(RangeError);
    expect(() => roundToIncrement(1n, 0n, 1n, 'UP')).toThrow(RangeError);
    expect(() => roundToIncrement(1n, 1n, 0n, 'UP')).toThrow(RangeError);
  });
});

describe('priceLegDistanceV1', () => {
  it('prices the first leg from the first-leg base and later legs from the additional base', () => {
    // 10 km: (3000 + 1200 x 10) = 15000; second leg (1000 + 1200 x 5) = 7000.
    expect(route([10_000, 5_000])).toEqual([
      { farePaise: 15_000n, taxPaise: 0n },
      { farePaise: 7_000n, taxPaise: 0n },
    ]);
  });

  it('rounds each leg once, so the drops always add up to their own total', () => {
    // 1.234 km: 3000 + 1480.8 = 4480.8 paise -> Rs 45; 1000 + 1480.8 = 2480.8 -> Rs 25.
    const drops = route([1_234, 1_234]);
    expect(drops.map((drop) => drop.farePaise)).toEqual([4_500n, 2_500n]);
    expect(drops.reduce((sum, drop) => sum + drop.farePaise, 0n)).toBe(7_000n);
  });

  it('applies the weight band of the whole booking to every leg', () => {
    expect(route([10_000], { weightGrams: 5_000 })[0]?.farePaise).toBe(15_000n); // 1.0x
    expect(route([10_000], { weightGrams: 5_001 })[0]?.farePaise).toBe(18_000n); // 1.2x
    expect(route([10_000], { weightGrams: 10_000 })[0]?.farePaise).toBe(18_000n);
    // The last band is open-ended: 3.0x of 15000 = 45000.
    expect(route([10_000], { weightGrams: 10_000_000 })[0]?.farePaise).toBe(45_000n);
  });

  it('never prices a drop below the category minimum', () => {
    // SMALL has no base and 1 paisa/km: a 100 m leg is 0.1 paise, so the minimum applies.
    const drops = priceLegDistanceV1(CONFIG, {
      vehicleCategory: 'SMALL',
      weightGrams: 1_000,
      legDistancesMeters: [100, 0],
    });
    expect(drops.map((drop) => drop.farePaise)).toEqual([500n, 500n]);
  });

  it('prices a zero-length leg at its base', () => {
    expect(route([0])[0]?.farePaise).toBe(3_000n);
  });

  it('carries no tax while taxes are not configured', () => {
    expect(route([10_000, 5_000]).every((drop) => drop.taxPaise === 0n)).toBe(true);
  });

  it('refuses an unpriced category and a distance that is not whole metres', () => {
    expect(() => route([1_000], { vehicleCategory: 'HELICOPTER' })).toThrow(UnpricedCategoryError);
    expect(() => route([1.5])).toThrow(RangeError);
    expect(() => route([-1])).toThrow(RangeError);
    expect(() => route([Number.NaN])).toThrow(RangeError);
  });
});

describe('haversineMeters', () => {
  it('is zero for the same point and symmetric between two points', () => {
    const jodhpur = { latitude: 26.2389, longitude: 73.0243 };
    const mandore = { latitude: 26.3448, longitude: 73.0458 };
    expect(haversineMeters(jodhpur, jodhpur)).toBe(0);
    expect(haversineMeters(jodhpur, mandore)).toBe(haversineMeters(mandore, jodhpur));
  });

  it('measures a known short distance in whole metres', () => {
    // About 11.8 km north through Jodhpur.
    const meters = haversineMeters(
      { latitude: 26.2389, longitude: 73.0243 },
      { latitude: 26.3448, longitude: 73.0458 },
    );
    expect(Number.isInteger(meters)).toBe(true);
    expect(meters).toBeGreaterThan(11_500);
    expect(meters).toBeLessThan(12_500);
  });

  it('measures a quarter of the Earth across a pole-to-equator span', () => {
    const quarter = Math.round((Math.PI / 2) * EARTH_RADIUS_METERS);
    expect(haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 90, longitude: 0 })).toBe(
      quarter,
    );
  });

  it('handles antipodal points without NaN from floating point drift', () => {
    const meters = haversineMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    expect(meters).toBe(Math.round(Math.PI * EARTH_RADIUS_METERS));
  });
});

describe('coordinates', () => {
  it('fixes coordinates to 6 decimals, so a stored quote can be re-explained', () => {
    expect(normalizeCoordinate(26.23891234)).toBe(26.238912);
    expect(normalizeCoordinate(26.2389115)).toBe(26.238912);
    // Math.round goes half towards +Infinity, so a negative coordinate exactly on the half
    // rounds towards zero. A coordinate is a measurement, not money: 6 decimals is ~0.1 m.
    expect(normalizeCoordinate(-73.0243005)).toBe(-73.0243);
    expect(coordinateText(26.2389)).toBe('26.238900');
    expect(coordinateText(-0.0000004)).toBe('0.000000');
  });
});

describe('parsePricingConfig', () => {
  const valid = legDistanceV1Config.parse({
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
  });

  function expectRejected(config: unknown): AppError {
    try {
      parsePricingConfig('LEG_DISTANCE_V1', config);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.PRICING_VERSION_INVALID);
      return error as AppError;
    }
    throw new Error('Expected the config to be refused');
  }

  it('accepts a valid config and lists its priced categories', () => {
    const parsed = parsePricingConfig('LEG_DISTANCE_V1', valid);
    expect(parsed.model).toBe('LEG_DISTANCE_V1');
    expect(pricedCategories(parsed)).toEqual(['MINI_TRUCK']);
  });

  it('refuses an unknown model, naming the models it supports', () => {
    try {
      parsePricingConfig('TIME_AND_DISTANCE_V2', valid);
      throw new Error('Expected the model to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe(ErrorCode.PRICING_VERSION_INVALID);
      expect(JSON.stringify((error as AppError).details)).toContain('LEG_DISTANCE_V1');
    }
  });

  it.each([
    ['no vehicles', { ...valid, vehicles: {} }],
    ['a lower-case category', { ...valid, vehicles: { mini: valid.vehicles.MINI_TRUCK } }],
    [
      'a minimum below Rs 1',
      { ...valid, vehicles: { A: { ...valid.vehicles.MINI_TRUCK, minimumLegFarePaise: 99 } } },
    ],
    [
      'a fractional rate',
      { ...valid, vehicles: { A: { ...valid.vehicles.MINI_TRUCK, perKmPaise: 12.5 } } },
    ],
    [
      'a negative rate',
      { ...valid, vehicles: { A: { ...valid.vehicles.MINI_TRUCK, perKmPaise: -1 } } },
    ],
    [
      'an amount above Rs 5,00,000',
      { ...valid, vehicles: { A: { ...valid.vehicles.MINI_TRUCK, perKmPaise: 50_000_001 } } },
    ],
    ['no weight bands', { ...valid, weightBands: [] }],
    [
      'a closed last band',
      { ...valid, weightBands: [{ upToGrams: 5_000, multiplierBps: 10_000 }] },
    ],
    [
      'an open band in the middle',
      {
        ...valid,
        weightBands: [
          { upToGrams: null, multiplierBps: 10_000 },
          { upToGrams: null, multiplierBps: 12_000 },
        ],
      },
    ],
    [
      'descending bands',
      {
        ...valid,
        weightBands: [
          { upToGrams: 10_000, multiplierBps: 10_000 },
          { upToGrams: 5_000, multiplierBps: 12_000 },
          { upToGrams: null, multiplierBps: 15_000 },
        ],
      },
    ],
    ['a zero multiplier', { ...valid, weightBands: [{ upToGrams: null, multiplierBps: 0 }] }],
    ['a zero rounding increment', { ...valid, legRounding: { incrementPaise: 0, mode: 'UP' } }],
    [
      'an unknown rounding mode',
      { ...valid, legRounding: { incrementPaise: 100, mode: 'BANKERS' } },
    ],
    ['another currency', { ...valid, currency: 'USD' }],
    ['another distance model', { ...valid, distanceModel: 'ROAD' }],
    ['a tax', { ...valid, taxes: [{ name: 'GST', percent: 18 }] }],
    ['an unknown field', { ...valid, surgeMultiplier: 2 }],
    ['not an object', 'LEG_DISTANCE_V1'],
    ['null', null],
  ])('refuses %s', (_name, config) => {
    const error = expectRejected(config);
    expect(error.details).toHaveProperty('issues');
  });
});

describe('the development prototype config file', () => {
  it('is valid for its model, and prices every category it lists', () => {
    const file = path.join(
      __dirname,
      '..',
      '..',
      '..',
      'pricing',
      'prototype-leg-distance-v1.json',
    );
    const pricing = parsePricingConfig(
      'LEG_DISTANCE_V1',
      JSON.parse(readFileSync(file, 'utf8')) as unknown,
    );
    expect(pricedCategories(pricing)).toEqual([
      'FOUR_WHEELER',
      'MINI_TRUCK',
      'PICKUP_TRUCK',
      'THREE_WHEELER',
      'TWO_WHEELER',
    ]);
    // The prototype's own example: Rs 30 + Rs 12/km for a 3-wheeler, 10 km, 1 kg, rounded up.
    expect(
      priceLegDistanceV1(pricing.config, {
        vehicleCategory: 'THREE_WHEELER',
        weightGrams: 1_000,
        legDistancesMeters: [10_000],
      }),
    ).toEqual([{ farePaise: 15_000n, taxPaise: 0n }]);
    // "Get a quote" vehicles are deliberately absent, so a quote for them is refused.
    expect(pricing.config.vehicles.JCB).toBeUndefined();
    expect(pricing.config.vehicles.CRANE).toBeUndefined();
  });
});
