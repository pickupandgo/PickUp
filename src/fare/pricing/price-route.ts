import { priceLegDistanceV1, type PricedDrop, type PricingRoute } from './leg-distance-v1';
import type { PricingConfig } from './pricing-config';

export type { PricedDrop, PricingRoute } from './leg-distance-v1';

/** Prices a route with the model its pricing version names. */
export function priceRoute(pricing: PricingConfig, route: PricingRoute): PricedDrop[] {
  switch (pricing.model) {
    case 'LEG_DISTANCE_V1':
      return priceLegDistanceV1(pricing.config, route);
  }
}
