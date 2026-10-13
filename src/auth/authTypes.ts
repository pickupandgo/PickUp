import type { User, ConfirmationResult, UserCredential } from '@react-native-firebase/auth';

export type { User, ConfirmationResult, UserCredential };

export interface AuthContextType {
  user: User | null;
  initializing: boolean;
  sendPhoneOTP: (phoneNumber: string, forceResend?: boolean) => Promise<ConfirmationResult>;
  verifyOTP: (otp: string, phoneNumber?: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<UserCredential>;
  signInWithEmail: (email: string, password: string) => Promise<UserCredential>;
  sendPasswordReset: (email: string) => Promise<void>;
  signInWithGoogle: () => Promise<UserCredential>;
  signInWithApple: () => Promise<UserCredential>;
  signOut: () => Promise<void>;
}
