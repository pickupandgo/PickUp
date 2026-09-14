import { Driver } from '../drivers/drivers.types';

/**
 * Seed data for the prototype.
 * Coordinates are in the Jodhpur, Rajasthan area.
 *
 * D1 → available → very close to default pickup (26.2389, 73.0243)
 * D2 → available → medium distance
 * D3 → unavailable → close (should be excluded from nearby results)
 * D4 → available → inside 5km radius
 * D5 → available → outside 5km radius (should be excluded by radius filter)
 */
export const MOCK_DRIVERS: Driver[] = [];
