import { RoutingService } from './RoutingService';
import { EngineRoutingProvider } from './EngineRoutingProvider';

// Export everything from the routing namespace
export * from './types';
export * from './geometry';
export * from './MockRoutingProvider';
export * from './EngineRoutingProvider';
export * from './RoutingService';

// Real-trip navigation always uses the authenticated backend. Mocks are explicit test fixtures only.
const defaultProvider = new EngineRoutingProvider();

export const routingService = new RoutingService(defaultProvider);
