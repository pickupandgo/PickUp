import React, { createContext, useContext, useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { signOut } from '../auth/authService';
import { isProfileComplete, setProfileComplete, clearSession } from './session';
import { registerCustomer } from '../api/payments';
import { hasPaymentsConfig } from '../config/env';

interface SessionContextValue {
  isLoggedIn: boolean | null;
  hasProfile: boolean;
  markProfileDone: (data?: any) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean>(false);

  useEffect(() => {
    const authInstance = getAuth();
    const subscriber = onAuthStateChanged(authInstance, async (user: any) => {
      if (user) {
        console.log('[AUTH] Auth state restored for Customer UID:', user.uid);
        // Register (or refresh) the customer with the payments backend. Safe to repeat; the
        // sign-in must carry a verified phone. Non-fatal: booking surfaces any real problem.
        if (hasPaymentsConfig()) {
          registerCustomer().catch(() => undefined);
        }
        const profileDone = await isProfileComplete();
        setHasProfile(profileDone);
        setIsLoggedIn(true);
      } else {
        console.log('[AUTH] Auth state unauthenticated for Customer');
        setHasProfile(false);
        setIsLoggedIn(false);
      }
    });
    return subscriber;
  }, []);

  const login = async () => {
    const profileDone = await isProfileComplete();
    setHasProfile(profileDone);
    setIsLoggedIn(true);
  };

  const markProfileDone = async (data?: any) => {
    await setProfileComplete(data);
    setHasProfile(true);
  };

  const logout = async () => {
    await signOut();
    await clearSession();
    setHasProfile(false);
    setIsLoggedIn(false);
  };

  return (
    <SessionContext.Provider value={{ isLoggedIn, hasProfile, markProfileDone, login, logout }}>
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
