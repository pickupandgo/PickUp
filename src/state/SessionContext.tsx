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
        const profile = await getCustomerProfile(user.uid);
        const profileDone = await isProfileComplete(user.uid);
        setUserProfile(profile);
        setHasProfile(profileDone);
        setIsLoggedIn(true);

        // Try syncing remote profile from backend
        try {
          const remoteProfile = await fetchUserProfileApi();
          if (remoteProfile && remoteProfile.fullName && remoteProfile.email) {
            const mappedData: CustomerProfileData = {
              fullName: remoteProfile.fullName,
              email: remoteProfile.email,
              phone: remoteProfile.phone,
              age: remoteProfile.age,
              address: remoteProfile.address,
              photoUri: remoteProfile.photoUri,
            };
            await setProfileComplete(mappedData, user.uid);
            setUserProfile(mappedData);
            setHasProfile(true);
          } else if (remoteProfile === null && !profileDone) {
            setHasProfile(false);
          }
        } catch (e) {
          console.log('[PROFILE] Could not sync remote profile from backend:', e);
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
    const profile = await getCustomerProfile(authUser?.uid);
    const profileDone = await isProfileComplete(authUser?.uid);
    setUserProfile(profile);
    setHasProfile(profileDone);
    setIsLoggedIn(true);
  };

  const markProfileDone = async (data?: CustomerProfileData) => {
    const authUser = getAuth().currentUser;
    if (data) {
      let mappedData: CustomerProfileData = {
        fullName: data.fullName.trim(),
        email: data.email.trim(),
        phone: data.phone?.trim(),
        age: data.age?.trim() || undefined,
        address: data.address?.trim() || undefined,
        photoUri: data.photoUri?.trim() || undefined,
      };

      try {
        const remoteProfile = await saveUserProfileApi(data);
        if (remoteProfile) {
          mappedData = {
            fullName: remoteProfile.fullName,
            email: remoteProfile.email,
            phone: remoteProfile.phone,
            age: remoteProfile.age,
            address: remoteProfile.address,
            photoUri: remoteProfile.photoUri,
          };
        }
      } catch (backendErr) {
        console.warn('[PROFILE] Backend sync skipped or unavailable. Profile saved locally scoped by UID:', backendErr);
      }

      await setProfileComplete(mappedData, authUser?.uid);
      setUserProfile(mappedData);
      setHasProfile(true);
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
          const mappedData: CustomerProfileData = {
            fullName: remoteProfile.fullName,
            email: remoteProfile.email,
            phone: remoteProfile.phone,
            age: remoteProfile.age,
            address: remoteProfile.address,
            photoUri: remoteProfile.photoUri,
          };
          await setProfileComplete(mappedData, authUser.uid);
          setUserProfile(mappedData);
          setHasProfile(true);
          return;
        }
      } catch {}
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
