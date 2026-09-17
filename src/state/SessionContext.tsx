import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getIsLoggedIn, setLoggedIn, clearSession } from './session';

interface SessionContextValue {
  isLoggedIn: boolean | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

export const SessionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    getIsLoggedIn().then((loggedIn) => {
      if (mounted) {
        setIsLoggedIn(loggedIn);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const login = async () => {
    await setLoggedIn();
    setIsLoggedIn(true);
  };

  const logout = async () => {
    await clearSession();
    setIsLoggedIn(false);
  };

  return (
    <SessionContext.Provider value={{ isLoggedIn, login, logout }}>
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
