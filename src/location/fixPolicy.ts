import type { LocationResult } from './types';
export function isFreshFix(fix: LocationResult | null | undefined, now = Date.now()): fix is LocationResult {
  return !!fix && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90 &&
    Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180 &&
    Number.isSafeInteger(fix.timestamp) && now - fix.timestamp <= 30000 && fix.timestamp - now <= 5000 &&
    Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 100;
}

export function newestFix(current: LocationResult | null, incoming: LocationResult, now = Date.now()): LocationResult | null {
  if (!isFreshFix(incoming, now)) return isFreshFix(current, now) ? current : null;
  return isFreshFix(current, now) && current.timestamp >= incoming.timestamp ? current : incoming;
}
