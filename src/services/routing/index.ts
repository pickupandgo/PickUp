import { RoutingService } from './RoutingService';
import { MockRoutingProvider } from './MockRoutingProvider';
import { EngineRoutingProvider } from './EngineRoutingProvider';
import { hasGeocodingConfig } from '../../config/env';

// Export everything from the routing namespace
export * from './types';
export * from './geometry';
export * from './MockRoutingProvider';
export * from './EngineRoutingProvider';
export * from './RoutingService';

// When a Google Maps key is configured, draw real road-following routes from the
// engine's Directions call (with a mock fallback baked in). Otherwise fall back
// to the straight-line mock so the map still renders in dev without a key.
const defaultProvider = hasGeocodingConfig()
  ? new EngineRoutingProvider()
  : new MockRoutingProvider({ averageSpeedKmh: 30 });

export const routingService = new RoutingService(defaultProvider);
