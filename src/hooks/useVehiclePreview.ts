import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { getVehiclePreview, PREVIEW_CATEGORIES, type PreviewVehicle } from '../api/vehiclePreview';
import type { GeoPoint } from '../api/types';
const foreground = (state: string | null) => state !== 'background' && state !== 'inactive';
export const useVehiclePreview = (point: GeoPoint | undefined, category: string | null | undefined, allowed = true) => {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(() => foreground(AppState.currentState));
  const [uid, setUid] = useState(() => getAuth().currentUser?.uid);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<{ key: string; vehicles: PreviewVehicle[]; status: 'loading' | 'ready' | 'error' }>({ key: '', vehicles: [], status: 'loading' });
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => onAuthStateChanged(getAuth(), user => setUid(user?.uid)), []);
  useEffect(() => { const sub = AppState.addEventListener('change', state => setActive(foreground(state))); return () => sub.remove(); }, []);
  const latitude = point?.latitude;
  const longitude = point?.longitude;
  const enabled = Boolean(allowed && uid && focused && active && category && PREVIEW_CATEGORIES.includes(category as any) && Number.isFinite(latitude) && Number.isFinite(longitude));
  const key = `${uid}:${latitude}:${longitude}:${category}`;
  useEffect(() => {
    if (!enabled || latitude === undefined || longitude === undefined || !category) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const expiry = setInterval(() => setNow(Date.now()), 1_000);
    const loop = async () => {
      controller = new AbortController();
      setSnapshot(previous => ({ key, vehicles: previous.key === key ? previous.vehicles : [], status: 'loading' }));
      try {
        const vehicles = await getVehiclePreview({ latitude, longitude }, category, controller.signal);
        if (cancelled || getAuth().currentUser?.uid !== uid) return;
        setNow(Date.now());
        setSnapshot({ key, vehicles, status: 'ready' });
      } catch {
        if (!cancelled) setSnapshot({ key, vehicles: [], status: 'error' });
      }
      if (!cancelled) timer = setTimeout(loop, 8_000);
    };
    void loop();
    return () => { cancelled = true; controller?.abort(); clearInterval(expiry); if (timer) clearTimeout(timer); };
  }, [enabled, key, latitude, longitude, category, uid, attempt]);
  return {
    vehicles: enabled && snapshot.key === key ? snapshot.vehicles.filter(vehicle => vehicle.expiresAt > now) : [],
    status: !enabled ? 'idle' as const : snapshot.key === key ? snapshot.status : 'loading' as const,
    refresh: useCallback(() => setAttempt(value => value + 1), []),
  };
};
