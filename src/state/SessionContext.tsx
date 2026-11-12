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

export interface SessionContextValue {
  isLoggedIn: boolean | null;
  hasProfile: boolean;
  userProfile: CustomerProfileData | null;
  markProfileDone: (data?: CustomerProfileData) => Promise<void>;
  refreshProfile: () => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean>(false);
  const [userProfile, setUserProfile] = useState<CustomerProfileData | null>(null);

  useEffect(() => {
    const authInstance = getAuth();
    const subscriber = onAuthStateChanged(authInstance, async (user: any) => {
      if (user) {
        console.log('[AUTH] Auth state restored for Customer UID:', user.uid);
        const localProfile = await getCustomerProfile(user.uid);
        setUserProfile(localProfile);
        setIsLoggedIn(true);

        // Authoritatively check backend customer profile
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
          } else {
            // Customer profile is not yet provisioned on the backend
            setHasProfile(false);
          }
        } catch (e) {
          console.warn('[PROFILE] Could not verify remote customer profile:', e);
          // If offline or network error, fallback to local profile check if previously completed
          const profileDone = await isProfileComplete(user.uid);
          setHasProfile(profileDone);
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
          setIsLoggedIn(true);
          return;
        }
      } catch (e) {
        console.warn('[PROFILE] Backend check failed during login:', e);
      }
    }
    const profile = await getCustomerProfile(authUser?.uid);
    const profileDone = await isProfileComplete(authUser?.uid);
    setUserProfile(profile);
    setHasProfile(profileDone);
    setIsLoggedIn(true);
  };

  const markProfileDone = async (data?: CustomerProfileData) => {
    const authUser = getAuth().currentUser;
    if (data) {
      // Must successfully persist to backend; never swallow failures
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
    } else {
      // If called without data, also call backend registration
      await saveUserProfileApi({ fullName: '', email: '' });
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
        } else {
          setHasProfile(false);
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
