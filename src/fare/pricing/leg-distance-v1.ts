import { BPS_SCALE, type LegDistanceV1Config, type LegRoundingMode } from './pricing-config';

export interface PricingRoute {
  readonly vehicleCategory: string;
  readonly weightGrams: number;
  /** One entry per drop: the distance of the leg that reaches it, in metres. */
  readonly legDistancesMeters: readonly number[];
}

export interface PricedDrop {
  readonly farePaise: bigint;
  readonly taxPaise: bigint;
}

const METERS_PER_KM = 1000n;
const BPS = BigInt(BPS_SCALE);

/** Thrown when the config has no rates for the requested vehicle category. */
export class UnpricedCategoryError extends Error {
  constructor(readonly vehicleCategory: string) {
    super(`No rates for vehicle category ${vehicleCategory}`);
    this.name = 'UnpricedCategoryError';
  }
}

/**
 * Prices a route under LEG_DISTANCE_V1 (see pricing-config.ts). Integer arithmetic only: the
 * exact fraction (base x 1000 + perKm x metres) x multiplier / (1000 x 10000) is rounded once,
 * per leg, by the version's rounding rule.
 */
export function priceLegDistanceV1(config: LegDistanceV1Config, route: PricingRoute): PricedDrop[] {
  const rates = config.vehicles[route.vehicleCategory];
  if (!rates) {
    throw new UnpricedCategoryError(route.vehicleCategory);
  }
  const band = config.weightBands.find(
    (candidate) => candidate.upToGrams === null || route.weightGrams <= candidate.upToGrams,
  );
  if (!band) {
    // Unreachable for a validated config: the last band is open-ended.
    throw new Error('No weight band applies');
  }
  const increment = BigInt(config.legRounding.incrementPaise);
  const minimum = BigInt(rates.minimumLegFarePaise);

  return route.legDistancesMeters.map((meters, index) => {
    if (!Number.isSafeInteger(meters) || meters < 0) {
      throw new RangeError('Leg distance must be a non-negative whole number of metres');
    }
    const base = BigInt(index === 0 ? rates.firstLegBasePaise : rates.additionalLegBasePaise);
    const numerator =
      (base * METERS_PER_KM + BigInt(rates.perKmPaise) * BigInt(meters)) *
      BigInt(band.multiplierBps);
    const denominator = METERS_PER_KM * BPS;
    const rounded = roundToIncrement(numerator, denominator, increment, config.legRounding.mode);
    return { farePaise: rounded < minimum ? minimum : rounded, taxPaise: 0n };
  });
}

/** numerator / denominator, rounded to a multiple of `increment` paise by `mode`. */
export function roundToIncrement(
  numerator: bigint,
  denominator: bigint,
  increment: bigint,
  mode: LegRoundingMode,
): bigint {
  if (numerator < 0n || denominator <= 0n || increment <= 0n) {
    throw new RangeError('Invalid rounding input');
  }
  const unit = denominator * increment;
  const whole = numerator / unit;
  const remainder = numerator % unit;
  switch (mode) {
    case 'DOWN':
      return whole * increment;
    case 'UP':
      return (remainder > 0n ? whole + 1n : whole) * increment;
    case 'HALF_UP':
      return (remainder * 2n >= unit ? whole + 1n : whole) * increment;
  }
}
