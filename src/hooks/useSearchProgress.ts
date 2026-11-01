import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { Ride } from '../api/types';
export interface SearchObservation { ride: Ride; receivedAt: number; }
/** A single offer's response window, never an overall search deadline or cancellation trigger. */
export function offerProgress(observation: SearchObservation | undefined, localNow: number) {
  if (!observation || localNow - observation.receivedAt > 10_000 || localNow < observation.receivedAt) return undefined;
  const { ride } = observation;
  if (ride.status !== 'REQUESTED' || ride.searchStatus !== 'OFFERED' || ride.offerStatus !== 'REQUESTED') return undefined;
  const server = Date.parse(ride.serverTime ?? '');
  const start = Date.parse(ride.offerRequestedAt ?? '');
  const end = Date.parse(ride.offerExpiresAt ?? '');
  if (![server, start, end].every(Number.isFinite) || end <= start || server < start - 5000) return undefined;
  const now = server + localNow - observation.receivedAt;
  return { fraction: Math.max(0, Math.min(1, (now - start) / (end - start))), remainingSeconds: Math.max(0, Math.ceil((end - now) / 1000)) };
}
export function useSearchProgress(observation: SearchObservation | undefined, enabled: boolean) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const [now, setNow] = useState(Date.now());
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => { const sub = AppState.addEventListener('change', state => setActive(state !== 'background' && state !== 'inactive')); return () => sub.remove(); }, []);
  useEffect(() => { if (!enabled || !focused || !active) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, [enabled, focused, active, observation]);
  return enabled && focused && active ? offerProgress(observation, Math.max(now, observation?.receivedAt ?? 0)) : undefined;
}
