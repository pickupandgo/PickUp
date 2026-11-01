import { retirePushRegistration } from '../services/pushRegistration';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { signOut } from '../auth/authService';
import { setProfileComplete, clearSession, type CustomerProfileData } from './session';
import { hasRequiredProfile } from './profileValidation';
import { fetchUserProfileApi, saveUserProfileApi, type BackendUserProfile } from '../api/userProfile';
import { registerCustomer } from '../api/payments';
import { hasPaymentsConfig } from '../config/env';
import { ApiError, toApiError } from '../api/http';

export type RegistrationStatus = 'checking' | 'needs_phone' | 'needs_profile' | 'ready' | 'blocked' | 'error';
export interface SessionContextValue {
  authUid: string | null;
  isLoggedIn: boolean | null;
  hasProfile: boolean | null;
  userProfile: CustomerProfileData | null;
  registrationStatus: RegistrationStatus;
  registrationError: string | null;
  retryRegistration: () => Promise<void>;
  markProfileDone: (data?: CustomerProfileData) => Promise<void>;
  refreshProfile: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}
const SessionContext = createContext<SessionContextValue | undefined>(undefined);
const mapProfile = (p: BackendUserProfile): CustomerProfileData => ({
  fullName: p.fullName, email: p.email, phone: p.phone, age: p.age, address: p.address,
});

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authUid, setAuthUid] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [userProfile, setUserProfile] = useState<CustomerProfileData | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<RegistrationStatus>('checking');
  const [registrationError, setRegistrationError] = useState<string | null>(null);
  // Each identity transition invalidates earlier work, including logout/relogin with the same UID.
  const generation = useRef(0);
  const mounted = useRef(true);
  const registrationFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const refreshFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const saving = useRef<string | null>(null);
  const requests = useRef(new Set<AbortController>());
  const cancelRequests = useCallback(() => {
    requests.current.forEach(controller => controller.abort());
    requests.current.clear();
    saving.current = null;
  }, []);
  const current = useCallback((uid: string, version: number) =>
    mounted.current && generation.current === version && getAuth().currentUser?.uid === uid, []);

  const acceptProfile = useCallback(async (profile: CustomerProfileData, uid: string, version: number) => {
    if (!current(uid, version)) return;
    const complete = hasRequiredProfile(profile);
    if (complete) await setProfileComplete(profile, uid);
    if (!current(uid, version)) return;
    setUserProfile(profile);
    setHasProfile(complete);
    setRegistrationStatus(complete ? 'ready' : 'needs_profile');
    setRegistrationError(null);
  }, [current]);

  const retryRegistration = useCallback((): Promise<void> => {
    const user = getAuth().currentUser;
    if (!user) return Promise.resolve();
    const version = generation.current;
    const key = user.uid + ':' + version;
    if (registrationFlight.current?.key === key) return registrationFlight.current.promise;
    setAuthUid(user.uid);
    setIsLoggedIn(true);
    setHasProfile(null);
    setRegistrationStatus('checking');
    setRegistrationError(null);
    const controller = new AbortController();
    requests.current.add(controller);
    const promise = (async () => {
      if (!user.phoneNumber) {
        if (current(user.uid, version)) {
          setHasProfile(false);
          setRegistrationStatus('needs_phone');
        }
        return;
      }
      try {
        if (!hasPaymentsConfig()) throw new ApiError('config', 'Customer account service is not configured.');
        await registerCustomer(controller.signal);
        if (!current(user.uid, version)) return;
        const remote = await fetchUserProfileApi(controller.signal);
        if (!remote) throw new Error('Your account could not be confirmed. Please retry.');
        await acceptProfile(mapProfile(remote), user.uid, version);
      } catch (error) {
        if (!current(user.uid, version)) return;
        const e = toApiError(error);
        setUserProfile(null);
        setHasProfile(false);
        setRegistrationError(e.userMessage);
        setRegistrationStatus(e.errorCode === 'PHONE_VERIFICATION_REQUIRED' ? 'needs_phone'
          : ['ACCOUNT_ROLE_CONFLICT', 'PHONE_ALREADY_REGISTERED', 'ACCOUNT_DISABLED'].includes(e.errorCode ?? '')
            ? 'blocked' : 'error');
      }
    })();
    registrationFlight.current = { key, promise };
    void promise.finally(() => {
      requests.current.delete(controller);
      if (registrationFlight.current?.promise === promise) registrationFlight.current = null;
    });
    return promise;
  }, [acceptProfile, current]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onAuthStateChanged(getAuth(), user => {
      generation.current += 1;
      cancelRequests();
      setUserProfile(null);
      setHasProfile(user ? null : false);
      setAuthUid(user?.uid ?? null);
      setIsLoggedIn(Boolean(user));
      setRegistrationError(null);
      setRegistrationStatus('checking');
      if (user) void retryRegistration();
    });
    return () => { mounted.current = false; generation.current += 1; cancelRequests(); unsubscribe(); };
  }, [retryRegistration, cancelRequests]);

  const markProfileDone = async (data?: CustomerProfileData) => {
    const user = getAuth().currentUser;
    if (!user?.phoneNumber) throw new Error('Verify your mobile number before saving your profile.');
    if (!data || !hasRequiredProfile(data)) throw new Error('Name, valid email, age and location/address are required.');
    const version = generation.current;
    const saveKey = user.uid + ':' + version;
    if (saving.current === saveKey) throw new Error('Your profile is already being saved.');
    saving.current = saveKey;
    const controller = new AbortController();
    requests.current.add(controller);
    try {
      const remote = await saveUserProfileApi(data, controller.signal);
      if (!current(user.uid, version)) throw new Error('Your sign-in changed. Please try again.');
      const profile = mapProfile(remote);
      if (!hasRequiredProfile(profile)) throw new Error('The server did not save all required details. Please retry.');
      await acceptProfile(profile, user.uid, version);
      if (!current(user.uid, version)) throw new Error('Your sign-in changed. Please try again.');
    } finally {
      requests.current.delete(controller);
      if (saving.current === saveKey) saving.current = null;
    }
  };

  const refreshProfile = useCallback((): Promise<void> => {
    const user = getAuth().currentUser;
    if (!user) return Promise.resolve();
    const version = generation.current;
    const key = user.uid + ':' + version;
    if (refreshFlight.current?.key === key) return refreshFlight.current.promise;
    const controller = new AbortController();
    requests.current.add(controller);
    const promise = (async () => {
      try {
        const remote = await fetchUserProfileApi(controller.signal);
        if (!remote) throw new Error('Your profile could not be confirmed. Please retry.');
        await acceptProfile(mapProfile(remote), user.uid, version);
      } catch (error) {
        // A temporary read failure must not turn a previously confirmed profile into a new account.
        if (current(user.uid, version)) {
          const e = toApiError(error);
          setRegistrationError(e.userMessage);
          if (e.status === 401 || ['ACCOUNT_ROLE_CONFLICT', 'ACCOUNT_DISABLED', 'USER_NOT_PROVISIONED'].includes(e.errorCode ?? '')) {
            setHasProfile(false);
            setRegistrationStatus(e.errorCode === 'ACCOUNT_DISABLED' || e.errorCode === 'ACCOUNT_ROLE_CONFLICT' ? 'blocked' : 'error');
          }
        }
      }
    })();
    refreshFlight.current = { key, promise };
    void promise.finally(() => {
      requests.current.delete(controller); if (refreshFlight.current?.promise === promise) refreshFlight.current = null; });
    return promise;
  }, [acceptProfile, current]);

  const logout = async () => {
    const uid = getAuth().currentUser?.uid;
    generation.current += 1;
    cancelRequests();
    await retirePushRegistration(uid).catch(() => {});
    if (getAuth().currentUser?.uid !== uid) return;
    await signOut();
    await clearSession(uid);
    // Another account could sign in during local cleanup.
    if (!mounted.current || getAuth().currentUser) return;
    setUserProfile(null); setHasProfile(false); setAuthUid(null); setIsLoggedIn(false);
    setRegistrationStatus('checking'); setRegistrationError(null);
  };

  return <SessionContext.Provider value={{ authUid, isLoggedIn, hasProfile, userProfile, registrationStatus,
    registrationError, retryRegistration, markProfileDone, refreshProfile, login: retryRegistration, logout }}>
    {children}
  </SessionContext.Provider>;
};
export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used within a SessionProvider');
  return context;
};

