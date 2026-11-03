import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { partnerProfileService, type PartnerProfile } from '../services/profile/PartnerProfileService';

// Invalidation carries no personal data and is never persisted.
const listeners = new Set<() => void>();
export function usePartnerProfile() {
  const [state, setState] = useState<{ uid: string | null; profile: PartnerProfile | null; loading: boolean; error: string | null }>({ uid: null, profile: null, loading: true, error: null });
  const generation = useRef(0); const focused = useRef(false); const busy = useRef(false);
  const ownListener = useRef<(() => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    const uid = getAuth().currentUser?.uid ?? null;
    const request = ++generation.current;
    const current = () => focused.current && request === generation.current && (getAuth().currentUser?.uid ?? null) === uid;
    setState({ uid, profile: null, loading: true, error: null });
    try {
      if (!uid) throw new Error('Please sign in again to view your profile.');
      const profile = await partnerProfileService.load(uid);
      if (current()) setState({ uid, profile, loading: false, error: null });
    } catch (error) {
      if (current()) setState({ uid, profile: null, loading: false, error: error instanceof Error ? error.message : 'Could not load your profile. Please retry.' });
    }
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true; refresh().catch(() => {});
    const invalidate = () => { refresh().catch(() => {}); };
    ownListener.current = invalidate;
    listeners.add(invalidate);
    return () => { focused.current = false; ++generation.current; listeners.delete(invalidate); ownListener.current = null; };
  }, [refresh]));
  useEffect(() => {
    let uid = getAuth().currentUser?.uid ?? null;
    return onAuthStateChanged(getAuth(), user => {
      const next = user?.uid ?? null;
      if (uid === next) return;
      uid = next; ++generation.current;
      setState({ uid, profile: null, loading: false, error: 'Please sign in again to view your profile.' });
      if (focused.current) refresh().catch(() => {});
    });
  }, [refresh]);
  const saveName = useCallback(async (name: string) => {
    if (busy.current) throw new Error('A profile update is already in progress.');
    const uid = getAuth().currentUser?.uid ?? null;
    if (!uid || uid !== state.uid || !state.profile) throw new Error('Please reload your profile before saving.');
    busy.current = true; setSaving(true);
    try {
      const actualName = await partnerProfileService.saveName(uid, state.profile.driverId, name);
      if (getAuth().currentUser?.uid !== uid) throw new Error('Your session changed. Please reload your profile.');
      if (focused.current) {
        ++generation.current; // A read started before the write must not replace its acknowledgement.
        setState({ uid, profile: { ...state.profile, name: actualName }, loading: false, error: null });
      }
      // Other focused consumers fetch confirmed server state. This editor keeps its acknowledged values.
      listeners.forEach(listener => { if (listener !== ownListener.current) listener(); });
      return actualName;
    } catch (error) {
      if ((error as { status?: number })?.status === 401 && getAuth().currentUser?.uid === uid) {
        ++generation.current;
        setState({ uid, profile: null, loading: false, error: 'Please sign in again to view your profile.' });
      }
      throw error;
    } finally { busy.current = false; setSaving(false); }
  }, [state.uid, state.profile]);
  const current = state.uid === (getAuth().currentUser?.uid ?? null);
  return { ...state, profile: current ? state.profile : null, saving, refresh, saveName };
}
