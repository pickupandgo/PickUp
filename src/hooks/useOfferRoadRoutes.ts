import { useEffect, useRef, useState } from 'react';
import type { LocationResult } from '../location/types';
import { isFreshFix } from '../location/fixPolicy';
import type { TripOffer } from '../types/trip';
import { displacementKm } from '../services/trip/offerDistances';
import { fetchOfferRoadRoutes, type OfferRoadRoutes } from '../services/trip/OfferRoadRoutes';
import { floatingPanel } from '../services/tracking/FloatingPanel';

export function useOfferRoadRoutes(offer: TripOffer, fix: LocationResult | null, now: number) {
  const [result, setResult] = useState<{ key: string; routes: OfferRoadRoutes } | null>(null);
  const [request, setRequest] = useState<{ key: string; fix: LocationResult } | null>(null);
  const key = `${offer.id}:${offer.dispatchOfferId ?? offer.expiresAt}`;
  const last = useRef<{ key: string; fix: LocationResult; time: number } | null>(null);
  useEffect(() => {
    if (!isFreshFix(fix, now) || !fix || offer.expiresAt <= now) return;
    const previous = last.current;
    // Aerial math is only a movement trigger; it is never a displayed distance.
    const moved = previous ? (displacementKm(previous.fix, fix) ?? 0) >= 0.05 : true;
    if (previous?.key === key && now - previous.time < 10000) return;
    if (previous?.key === key && !moved && now - previous.time < 30000) return;
    last.current = { key, fix, time: now };
    setResult(null);
    setRequest({ key, fix });
  }, [fix, key, now, offer.expiresAt]);
  useEffect(() => {
    if (!request || request.key !== key) return;
    let active = true;
    fetchOfferRoadRoutes(offer, request.fix).then(routes => {
      if (!active) return;
      setResult({ key, routes });
      floatingPanel.update(offer, null, routes);
    }).catch(() => { if (active) setResult(null); });
    return () => { active = false; };
    // Coordinates/identity are frozen for the request; repeated inbox polls must not cancel it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, key]);
  return result?.key === key && isFreshFix(fix, now) && offer.expiresAt > now ? result.routes : null;
}
