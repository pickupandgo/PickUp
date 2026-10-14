import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * Pricing models the Fare module can run. A pricing version names its model and carries the
 * rates as config; the code below has no rates of its own. A new kind of pricing (time-based,
 * zones, GST) is a new model here plus a new version, never an edit to an existing version.
 */
export const PRICING_MODELS = ['LEG_DISTANCE_V1'] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const VEHICLE_CATEGORY_PATTERN = /^[A-Z][A-Z0-9_]{0,49}$/;

/** The most any single amount in a config may be: Rs 5,00,000, Razorpay's per-order limit. */
const MAX_PAISE = 50_000_000;
/** 10000 basis points = 1x. */
export const BPS_SCALE = 10_000;

const paise = z.number().int().min(0).max(MAX_PAISE);

const vehicleRates = z
  .object({
    /** Base for the leg from the pickup to the first drop. */
    firstLegBasePaise: paise,
    /** Base for each following leg (drop to drop). */
    additionalLegBasePaise: paise,
    /** Per kilometre of the leg. */
    perKmPaise: paise,
    /**
     * Floor for one drop's fare after rounding. At least Rs 1, so every drop can be collected
     * on its own (Razorpay's minimum) when the receivers pay.
     */
    minimumLegFarePaise: z.number().int().min(100).max(MAX_PAISE),
  })
  .strict();

const weightBand = z
  .object({
    /** Upper bound of the band, in grams (inclusive); null for the last, open-ended band. */
    upToGrams: z.number().int().positive().nullable(),
    /** Multiplier applied to each leg, in basis points: 10000 = 1x, 12000 = 1.2x. */
    multiplierBps: z
      .number()
      .int()
      .min(1)
      .max(100 * BPS_SCALE),
  })
  .strict();

/**
 * LEG_DISTANCE_V1: each drop pays for the leg that reaches it.
 *
 *   leg fare = round((base + perKm x km) x weight multiplier, legRounding), at least minimum
 *
 * where base is firstLegBasePaise for drop 1 and additionalLegBasePaise for every later drop,
 * km is that leg's distance, and the weight band comes from the booking's total weight. The
 * booking total is the sum of the drops, so the per-drop amounts always add up exactly.
 */
export const legDistanceV1Config = z
  .object({
    currency: z.literal('INR'),
    /** How leg distances are measured. HAVERSINE = straight line between the coordinates. */
    distanceModel: z.literal('HAVERSINE'),
    vehicles: z
      .record(z.string().regex(VEHICLE_CATEGORY_PATTERN), vehicleRates)
      .refine((vehicles) => Object.keys(vehicles).length > 0, {
        message: 'at least one vehicle category is required',
      }),
    weightBands: z
      .array(weightBand)
      .min(1)
      .superRefine((bands, ctx) => {
        bands.forEach((band, index) => {
          const last = index === bands.length - 1;
          if (last !== (band.upToGrams === null)) {
            ctx.addIssue({
              code: 'custom',
              message: 'only the last weight band is open-ended (upToGrams: null)',
              path: [index, 'upToGrams'],
            });
          }
          const previous = bands[index - 1]?.upToGrams;
          if (
            index > 0 &&
            band.upToGrams !== null &&
            previous !== null &&
            previous !== undefined &&
            band.upToGrams <= previous
          ) {
            ctx.addIssue({
              code: 'custom',
              message: 'weight bands must be in ascending order',
              path: [index, 'upToGrams'],
            });
          }
        });
      }),
    /** How each leg's fare is rounded, e.g. up to the next whole rupee. */
    legRounding: z
      .object({
        incrementPaise: z.number().int().min(1).max(100_000),
        mode: z.enum(['UP', 'HALF_UP', 'DOWN']),
      })
      .strict(),
    /**
     * Taxes on the fare. None in V1: a tax needs a CA-approved rule and a pricing model that
     * computes it, so a non-empty list is refused here.
     */
    taxes: z.array(z.unknown()).max(0, { message: 'taxes are not supported by LEG_DISTANCE_V1' }),
  })
  .strict();

export type LegDistanceV1Config = z.infer<typeof legDistanceV1Config>;
export type LegRoundingMode = LegDistanceV1Config['legRounding']['mode'];

export type PricingConfig = {
  readonly model: 'LEG_DISTANCE_V1';
  readonly config: LegDistanceV1Config;
};

/**
 * Validates a version's config for its model. Used when a version is created and again whenever
 * one is read, so a hand-edited row can never price a quote.
 */
export function parsePricingConfig(model: string, config: unknown): PricingConfig {
  if (model !== 'LEG_DISTANCE_V1') {
    throw invalidConfig([
      { path: 'model', message: `must be one of ${PRICING_MODELS.join(', ')}` },
    ]);
  }
  const parsed = legDistanceV1Config.safeParse(config);
  if (!parsed.success) {
    throw invalidConfig(
      parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    );
  }
  return { model, config: parsed.data };
}

/** The vehicle categories a config prices. */
export function pricedCategories(pricing: PricingConfig): string[] {
  return Object.keys(pricing.config.vehicles).sort();
}

function invalidConfig(issues: { path: string; message: string }[]): AppError {
  return new AppError(
    ErrorCode.PRICING_VERSION_INVALID,
    HttpStatus.BAD_REQUEST,
    'The pricing configuration is invalid',
    { issues },
  );
}
