import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ArrivalDetectionService } from '../services/trip/ArrivalDetectionService';
import type { ArrivalEvent } from '../services/trip/ArrivalDetectionService';

/**
 * Hook to consume arrival detection events in the UI layer.
 * Note: The UI component (like ActiveTripScreen) does not manage the geofence lifecycle directly.
 * It merely reacts to arrival events to navigate or show prompts.
 */
export function useArrivalDetection(onArrival: (event: ArrivalEvent) => void) {
  const latest = useRef(onArrival);
  latest.current = onArrival;
  useFocusEffect(
    useCallback(() => {
      let focused = true;
      const service = ArrivalDetectionService.getInstance();
      const unsubscribe = service.subscribe(event => {
        if (focused) latest.current(event);
      });

      return () => {
        focused = false;
        unsubscribe();
      };
    }, []),
  );
}
