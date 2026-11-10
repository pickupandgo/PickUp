import { useState, useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getCurrentDriverId,
  getTripById,
  engineTripToHistoricalTrip,
} from '../services/engine/dispatch';
import type { HistoricalTrip } from '../types/trip';

export function useHistoricalTrip(tripId: string) {
  const uid = getCurrentDriverId(),
    key = `${uid}:${tripId}`;
  const [state, setState] = useState({
    key,
    trip: null as HistoricalTrip | null,
    loading: true,
    error: null as string | null,
  });
  const sequence = useRef(0);
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    setState({ key, trip: null, loading: true, error: null });
    try {
      const value = await getTripById(tripId);
      if (request !== sequence.current || getCurrentDriverId() !== uid) return;
      if (!uid || value.id !== tripId || value.driverId !== uid)
        throw new Error('Trip identity mismatch');
      setState({
        key,
        trip: engineTripToHistoricalTrip(value),
        loading: false,
        error: null,
      });
    } catch {
      if (request === sequence.current && getCurrentDriverId() === uid)
        setState({
          key,
          trip: null,
          loading: false,
          error: 'This trip could not be loaded. Please retry.',
        });
    }
  }, [uid, key, tripId]);
  useFocusEffect(
    useCallback(() => {
      void reload();
      return () => {
        ++sequence.current;
      };
    }, [reload]),
  );
  return {
    trip: state.key === key ? state.trip : null,
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    reload,
  };
}
