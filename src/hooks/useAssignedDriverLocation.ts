import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { getDriver } from '../api/engine';
import { toApiError } from '../api/http';
import type { NearbyDriver } from '../api/types';
const foreground = (state: string | null) => state !== 'background' && state !== 'inactive';
const fresh = (driver: NearbyDriver | undefined, now: number) => Boolean(driver && Number.isFinite(driver.latitude) && Math.abs(driver.latitude) <= 90 && Number.isFinite(driver.longitude) && Math.abs(driver.longitude) <= 180 && Number.isFinite(driver.capturedAt) && now - driver.capturedAt! <= 60_000 && driver.capturedAt! - now <= 5_000);
/** Assigned-trip GPS only: single-flight, focus/identity scoped, capture-ordered and locally expiring. */
export const useAssignedDriverLocation = (tripId: string | undefined, driverId: string | undefined, enabled = true) => {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(() => foreground(AppState.currentState));
  const [uid, setUid] = useState(() => getAuth().currentUser?.uid);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [snapshot, setSnapshot] = useState<{ key: string; driver?: NearbyDriver; status: 'loading' | 'live' | 'unavailable' | 'error' | 'auth_error' }>({ key: '', status: 'loading' });
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  useEffect(() => onAuthStateChanged(getAuth(), user => setUid(user?.uid)), []);
  useEffect(() => { const sub = AppState.addEventListener('change', state => setActive(foreground(state))); return () => sub.remove(); }, []);
  const canPoll = Boolean(enabled && tripId && driverId && uid && focused && active);
  const key = `${uid}:${tripId}:${driverId}`;
  useEffect(() => {
    if (!canPoll || !driverId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let newest: NearbyDriver | undefined;
    const expiry = setInterval(() => setNow(Date.now()), 1_000);
    const loop = async () => {
      controller = new AbortController();
      try {
        const next = await getDriver(driverId, controller.signal);
        if (cancelled || getAuth().currentUser?.uid !== uid) return;
        const now = Date.now();
        setNow(now);
        if (next.id !== driverId || !fresh(next, now)) setSnapshot({ key, status: 'unavailable' });
        else {
          if (!newest || next.capturedAt! > newest.capturedAt!) newest = next;
          setSnapshot({ key, driver: newest, status: 'live' });
        }
      } catch (error) {
        if (cancelled) return;
        const parsed = toApiError(error);
        setSnapshot({ key, status: parsed.status === 401 || parsed.status === 403 ? 'auth_error' : parsed.errorCode === 'LOCATION_UNAVAILABLE' ? 'unavailable' : 'error' });
      }
      if (!cancelled) timer = setTimeout(loop, 5_000);
    };
    void loop();
    return () => { cancelled = true; controller?.abort(); clearInterval(expiry); if (timer) clearTimeout(timer); };
  }, [canPoll, key, driverId, uid, attempt]);
  const current = canPoll && snapshot.key === key ? snapshot : undefined;
  const driver = current?.status === 'live' && fresh(current.driver, now) ? current.driver : undefined;
  return {
    driver,
    point: driver ? { latitude: driver.latitude, longitude: driver.longitude } : undefined,
    status: !canPoll ? 'idle' as const : !current ? 'loading' as const : current.status === 'live' && !driver ? 'stale' as const : current.status,
    refresh: useCallback(() => setAttempt(value => value + 1), []),
  };
};
