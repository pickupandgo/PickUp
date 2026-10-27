import React, { createContext, useContext, useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { signOut } from '../auth/authService';
import {
  isProfileComplete,
  setProfileComplete,
  clearSession,
  getCustomerProfile,
  type CustomerProfileData,
} from './session';
import { fetchUserProfileApi, saveUserProfileApi } from '../api/userProfile';
import { registerCustomer } from '../api/payments';
import { hasPaymentsConfig } from '../config/env';

export interface SessionContextValue {
  isLoggedIn: boolean | null;
  hasProfile: boolean | null;
  userProfile: CustomerProfileData | null;
  markProfileDone: (data?: CustomerProfileData) => Promise<void>;
  refreshProfile: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [userProfile, setUserProfile] = useState<CustomerProfileData | null>(null);

  useEffect(() => {
    const authInstance = getAuth();
    const subscriber = onAuthStateChanged(authInstance, async (user: any) => {
      if (user) {
        console.log('[AUTH] Auth state restored for Customer UID:', user.uid);
        if (hasPaymentsConfig()) {
          registerCustomer().catch(() => undefined);
        }

        const [localProfile, profileDone] = await Promise.all([
          getCustomerProfile(user.uid),
          isProfileComplete(user.uid),
        ]);
        const hasLocalProfile = Boolean(profileDone || (localProfile?.fullName && localProfile?.email));
        setUserProfile(localProfile);

        if (hasLocalProfile) {
          // Immediately set hasProfile and isLoggedIn so RootNavigator routes straight to MainNavigator without flash
          setHasProfile(true);
          setIsLoggedIn(true);

          // Sync remote profile in background without flipping navigation
          fetchUserProfileApi()
            .then(async (remoteProfile) => {
              if (remoteProfile) {
                const mappedData: CustomerProfileData = {
                  fullName: remoteProfile.fullName || localProfile?.fullName || '',
                  email: remoteProfile.email || localProfile?.email || '',
                  phone: remoteProfile.phone || localProfile?.phone || user.phoneNumber || '',
                  age: localProfile?.age,
                  address: localProfile?.address,
                  photoUri: localProfile?.photoUri,
                };
                await setProfileComplete(mappedData, user.uid);
                setUserProfile(mappedData);
              }
            })
            .catch((e) => {
              console.warn('[PROFILE] Background remote profile sync warning:', e);
            });
        } else {
          try {
            const remoteProfile = await fetchUserProfileApi();
            if (remoteProfile) {
              const mappedData: CustomerProfileData = {
                fullName: remoteProfile.fullName || localProfile?.fullName || '',
                email: remoteProfile.email || localProfile?.email || '',
                phone: remoteProfile.phone || localProfile?.phone || user.phoneNumber || '',
                age: localProfile?.age,
                address: localProfile?.address,
                photoUri: localProfile?.photoUri,
              };
              await setProfileComplete(mappedData, user.uid);
              setUserProfile(mappedData);
              setHasProfile(true);
              setIsLoggedIn(true);
            } else {
              const done = await isProfileComplete(user.uid);
              setHasProfile(done);
              setIsLoggedIn(true);
            }
          } catch (e) {
            console.warn('[PROFILE] Could not verify remote customer profile:', e);
            const done = await isProfileComplete(user.uid);
            setHasProfile(done);
            setIsLoggedIn(true);
          }
        }
      } else {
        console.log('[AUTH] Auth state unauthenticated for Customer');
        setUserProfile(null);
        setHasProfile(false);
        setIsLoggedIn(false);
      }
    });
    return subscriber;
  }, []);

  const login = async () => {
    const authUser = getAuth().currentUser;
    if (authUser) {
      const [localProfile, profileDone] = await Promise.all([
        getCustomerProfile(authUser.uid),
        isProfileComplete(authUser.uid),
      ]);
      const hasLocalProfile = Boolean(profileDone || (localProfile?.fullName && localProfile?.email));
      if (hasLocalProfile) {
        setUserProfile(localProfile);
        setHasProfile(true);
        setIsLoggedIn(true);
        return;
      }

      try {
        const remoteProfile = await fetchUserProfileApi();
        if (remoteProfile) {
          const mappedData: CustomerProfileData = {
            fullName: remoteProfile.fullName || localProfile?.fullName || '',
            email: remoteProfile.email || localProfile?.email || '',
            phone: remoteProfile.phone || localProfile?.phone || authUser.phoneNumber || '',
            age: localProfile?.age,
            address: localProfile?.address,
            photoUri: localProfile?.photoUri,
          };
          await setProfileComplete(mappedData, authUser.uid);
          setUserProfile(mappedData);
          setHasProfile(true);
          setIsLoggedIn(true);
          return;
        }
      } catch (e) {
        console.warn('[PROFILE] Backend check failed during login:', e);
      }
      setUserProfile(localProfile);
      setHasProfile(false);
      setIsLoggedIn(true);
    } else {
      const profile = await getCustomerProfile();
      const profileDone = await isProfileComplete();
      setUserProfile(profile);
      setHasProfile(Boolean(profileDone || (profile?.fullName && profile?.email)));
      setIsLoggedIn(true);
    }
  };

  const markProfileDone = async (data?: CustomerProfileData) => {
    const authUser = getAuth().currentUser;
    if (data) {
      try {
        const remoteProfile = await saveUserProfileApi(data);
        const mappedData: CustomerProfileData = {
          fullName: remoteProfile.fullName || data.fullName.trim(),
          email: remoteProfile.email || data.email.trim(),
          phone: remoteProfile.phone || data.phone?.trim() || '',
          age: data.age?.trim() || undefined,
          address: data.address?.trim() || undefined,
          photoUri: data.photoUri?.trim() || undefined,
        };
        await setProfileComplete(mappedData, authUser?.uid);
        setUserProfile(mappedData);
        setHasProfile(true);
      } catch (err) {
        // Fallback local save if remote unavailable
        await setProfileComplete(data, authUser?.uid);
        setUserProfile(data);
        setHasProfile(true);
      }
    } else {
      await setProfileComplete(undefined, authUser?.uid);
      setHasProfile(true);
    }
  };

  const refreshProfile = async () => {
    const authUser = getAuth().currentUser;
    if (authUser) {
      try {
        const remoteProfile = await fetchUserProfileApi();
        if (remoteProfile) {
          const localProfile = await getCustomerProfile(authUser.uid);
          const mappedData: CustomerProfileData = {
            fullName: remoteProfile.fullName || localProfile?.fullName || '',
            email: remoteProfile.email || localProfile?.email || '',
            phone: remoteProfile.phone || localProfile?.phone || authUser.phoneNumber || '',
            age: localProfile?.age,
            address: localProfile?.address,
            photoUri: localProfile?.photoUri,
          };
          await setProfileComplete(mappedData, authUser.uid);
          setUserProfile(mappedData);
          setHasProfile(true);
          return;
        }
      } catch (err) {
        console.warn('[PROFILE] Failed to refresh profile from backend:', err);
      }
      const profile = await getCustomerProfile(authUser.uid);
      setUserProfile(profile);
      const profileDone = await isProfileComplete(authUser.uid);
      setHasProfile(profileDone);
    }
  };

  const logout = async () => {
    const authUser = getAuth().currentUser;
    await signOut();
    await clearSession(authUser?.uid);
    setUserProfile(null);
    setHasProfile(false);
    setIsLoggedIn(false);
  };

  return (
    <SessionContext.Provider
      value={{
        isLoggedIn,
        hasProfile,
        userProfile,
        markProfileDone,
        refreshProfile,
        login,
        logout,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
