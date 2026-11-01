import { paiseToNumber } from '../common/money';
import type { FareQuote, FareQuoteStop, PricingVersion } from '../generated/prisma/client';
import type {
  FareQuoteDropResponse,
  FareQuoteResponse,
  PricingPreviewResponse,
  PricingVersionResponse,
} from './fare.dto';
import type { PricedQuote } from './fare-pricer';

type CustomerChargeKeys =
  'deliveryFarePaise' | 'customerPlatformFeePaise' | 'customerPlatformFeeBps' | 'surgeChargePaise';
export type QuoteWithStops = Omit<FareQuote, CustomerChargeKeys> &
  Partial<Pick<FareQuote, CustomerChargeKeys>> & {
    stops: FareQuoteStop[];
    pricingVersion: Pick<PricingVersion, 'id' | 'code'>;
  };

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function toFareQuoteResponse(quote: QuoteWithStops): FareQuoteResponse {
  return {
    quoteId: quote.id,
    ...(quote.deliveryFarePaise != null &&
    quote.customerPlatformFeePaise != null &&
    quote.customerPlatformFeeBps != null &&
    quote.surgeChargePaise != null
      ? {
          deliveryFarePaise: paiseToNumber(quote.deliveryFarePaise),
          customerPlatformFeePaise: paiseToNumber(quote.customerPlatformFeePaise),
          customerPlatformFeeBps: quote.customerPlatformFeeBps,
          surgeChargePaise: paiseToNumber(quote.surgeChargePaise),
        }
      : {}),
    pricingVersion: { pricingVersionId: quote.pricingVersion.id, code: quote.pricingVersion.code },
    vehicleCategory: quote.vehicleCategory,
    weightKg: quote.weightGrams / 1000,
    pickup: {
      latitude: quote.pickupLatitude.toNumber(),
      longitude: quote.pickupLongitude.toNumber(),
    },
    distanceMeters: quote.distanceMeters,
    farePaise: paiseToNumber(quote.farePaise),
    taxPaise: paiseToNumber(quote.taxPaise),
    payablePaise: paiseToNumber(quote.payablePaise),
    currency: 'INR',
    drops: [...quote.stops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((stop): FareQuoteDropResponse => ({
        sequence: stop.sequence,
        latitude: stop.latitude.toNumber(),
        longitude: stop.longitude.toNumber(),
        distanceMeters: stop.distanceMeters,
        farePaise: paiseToNumber(stop.farePaise),
        taxPaise: paiseToNumber(stop.taxPaise),
        payablePaise: paiseToNumber(stop.payablePaise),
      })),
    expiresAt: quote.expiresAt.toISOString(),
    redeemed: quote.redeemedAt !== null,
    createdAt: quote.createdAt.toISOString(),
  };
}

export function toPricingVersionResponse(
  version: PricingVersion,
  now: Date,
): PricingVersionResponse {
  return {
    pricingVersionId: version.id,
    code: version.code,
    model: version.model,
    config: version.config as Record<string, unknown>,
    effectiveFrom: version.effectiveFrom.toISOString(),
    effectiveTo: iso(version.effectiveTo),
    active: version.active,
    inEffect:
      version.active &&
      version.effectiveFrom <= now &&
      (version.effectiveTo === null || version.effectiveTo > now),
    reason: version.reason,
    createdByUserId: version.createdByUserId,
    deactivatedAt: iso(version.deactivatedAt),
    deactivationReason: version.deactivationReason,
    createdAt: version.createdAt.toISOString(),
  };
}

export function toPricingPreviewResponse(priced: PricedQuote): PricingPreviewResponse {
  return {
    pricingVersion: { pricingVersionId: priced.version.id, code: priced.version.code },
    distanceMeters: priced.distanceMeters,
    ...(priced.deliveryFarePaise !== undefined && priced.customerPlatformFeePaise !== undefined
      ? {
          deliveryFarePaise: paiseToNumber(priced.deliveryFarePaise),
          customerPlatformFeePaise: paiseToNumber(priced.customerPlatformFeePaise),
          customerPlatformFeeBps: priced.customerPlatformFeeBps,
          surgeChargePaise: paiseToNumber(priced.surgeChargePaise ?? 0n),
        }
      : {}),
    farePaise: paiseToNumber(priced.farePaise),
    taxPaise: paiseToNumber(priced.taxPaise),
    payablePaise: paiseToNumber(priced.payablePaise),
    drops: priced.drops.map((drop) => ({
      sequence: drop.sequence,
      latitude: drop.location.latitude,
      longitude: drop.location.longitude,
      distanceMeters: drop.distanceMeters,
      farePaise: paiseToNumber(drop.farePaise),
      taxPaise: paiseToNumber(drop.taxPaise),
      payablePaise: paiseToNumber(drop.payablePaise),
    })),
  };
}
