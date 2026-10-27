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

// Draw real road-following routes from the engine / Google Directions / OSRM call
// (with graceful fallback). This guarantees real road directions even when Google
// quotas are exhausted or keys are unconfigured.
const defaultProvider = new EngineRoutingProvider();

export const routingService = new RoutingService(defaultProvider);

