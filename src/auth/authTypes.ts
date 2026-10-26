import type { User, ConfirmationResult } from '@react-native-firebase/auth';

export type { User, ConfirmationResult };

export interface AuthContextType {
  user: User | null;
  initializing: boolean;
  sendPhoneOTP: (phoneNumber: string, forceResend?: boolean) => Promise<ConfirmationResult>;
  verifyOTP: (otp: string, phoneNumber?: string) => Promise<void>;
  signOut: () => Promise<void>;
}
