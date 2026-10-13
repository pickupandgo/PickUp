import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getPaymentsApi } from '../services/payments';
import type { DriverTripDto } from '../services/payments/collectionsDto';

export interface UseCollectableTripsOptions {
  /** How often to re-check while the screen is focused. */
  readonly pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 20_000;

/**
 * The driver's running trips whose payment can be collected right now (pay at pickup once
 * arrived; pay at delivery once every drop is delivered), as the payments backend reports them.
 * Re-checked while the screen is focused, so a banner appears as soon as the window opens.
 * Failures are silent: the banner just stays hidden and the next check tries again.
 */
export function useCollectableTrips(
  options: UseCollectableTripsOptions = {},
): readonly DriverTripDto[] {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const [trips, setTrips] = useState<readonly DriverTripDto[]>([]);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const api = getPaymentsApi();
      if (!api) {
        return undefined;
      }
      let active = true;
      const load = () => {
        api
          .listActiveTrips()
          .then(list => {
            if (active && mounted.current) {
              setTrips(list.filter(trip => trip.payment.collectionOpen));
            }
          })
          .catch(() => undefined);
      };
      load();
      const timer = setInterval(load, pollIntervalMs);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [pollIntervalMs]),
  );

  return trips;
}
