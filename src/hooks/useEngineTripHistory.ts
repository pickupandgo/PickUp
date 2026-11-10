import { useState, useCallback } from 'react';
import { useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  getCurrentDriverId,
  getDriverHistoryPage,
} from '../services/engine/dispatch';
import type { HistoricalTrip } from '../types/trip';

export function useEngineTripHistory() {
  const uid = getCurrentDriverId();
  const [state, setState] = useState({
    uid,
    trips: [] as HistoricalTrip[],
    nextCursor: null as string | null,
    isLoading: true,
    error: null as string | null,
  });
  const sequence = useRef(0),
    busy = useRef(false),
    cursor = useRef<string | null>(null);
  const fetchPage = useCallback(
    async (more: boolean) => {
      if (more && (busy.current || !cursor.current)) return;
      const request = ++sequence.current;
      const next = more ? cursor.current ?? undefined : undefined;
      busy.current = true;
      const current = () =>
        sequence.current === request && !!uid && getCurrentDriverId() === uid;
      setState(old => ({
        ...(more && old.uid === uid
          ? old
          : { uid, trips: [], nextCursor: null }),
        isLoading: true,
        error: null,
      }));
      try {
        if (!uid) throw new Error('Please sign in again.');
        const page = await getDriverHistoryPage(next);
        if (!current()) return;
        cursor.current = page.nextCursor;
        setState(old => ({
          uid,
          trips: [
            ...new Map(
              [
                ...(more && old.uid === uid ? old.trips : []),
                ...page.trips,
              ].map(trip => [trip.id, trip]),
            ).values(),
          ],
          nextCursor: page.nextCursor,
          isLoading: false,
          error: null,
        }));
      } catch {
        if (sequence.current === request && getCurrentDriverId() === uid)
          setState(old => ({
            ...old,
            isLoading: false,
            error: 'Trip history could not be loaded. Please retry.',
          }));
      } finally {
        if (sequence.current === request) busy.current = false;
      }
    },
    [uid],
  );
  const fetchHistory = useCallback(() => fetchPage(false), [fetchPage]);
  const loadMore = useCallback(() => fetchPage(true), [fetchPage]);
  useFocusEffect(
    useCallback(() => {
      cursor.current = null;
      void fetchHistory();
      return () => {
        ++sequence.current;
        busy.current = false;
      };
    }, [fetchHistory]),
  );
  return {
    trips: state.uid === uid ? state.trips : [],
    nextCursor: state.uid === uid ? state.nextCursor : null,
    isLoading: state.uid !== uid || state.isLoading,
    error: state.uid === uid ? state.error : null,
    fetchHistory,
    loadMore,
  };
}
