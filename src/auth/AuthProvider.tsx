import React, { createContext, useContext, useEffect, useState } from 'react';
import { getAuth, onAuthStateChanged, type User } from '@react-native-firebase/auth';
import { AuthContextType } from './authTypes';
import {
  sendPhoneOTP,
  verifyOTP,
  signOut,
} from './authService';

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const subscriber = onAuthStateChanged(getAuth(), (userState: User | null) => {
      setUser(userState);
      if (initializing) setInitializing(false);
    });
    return subscriber; // unsubscribe on unmount
  }, [initializing]);

  return (
    <AuthContext.Provider
      value={{
        user,
        initializing,
        sendPhoneOTP,
        verifyOTP,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
