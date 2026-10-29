import { ApiClient } from '../api/ApiClient';
import { env } from '../../config/env';
import {
  getAuth,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut as fbSignOut,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  type User,
  type ConfirmationResult,
} from '@react-native-firebase/auth';
import {
  OtpCooldownManager,
  usePhoneCooldown,
  DEFAULT_COOLDOWN_SECONDS,
} from './OtpCooldownManager';
import {
  DriverOnboardingService,
  type DriverOnboardingSummary,
} from '../onboarding/DriverOnboardingService';

export type { User, ConfirmationResult };
export type { DriverOnboardingSummary } from '../onboarding/DriverOnboardingService';
export { OtpCooldownManager, usePhoneCooldown };

export interface IAuthService {
  requestOtp(phone: string, forceResend?: boolean): Promise<void>;
  verifyOtp(
    phone: string,
    otp: string,
  ): Promise<{ token: string; isNewUser: boolean }>;
  loginWithEmail(
    email: string,
    password: string,
  ): Promise<{ token: string; isNewUser: boolean }>;
  signUpWithEmail(
    email: string,
    password: string,
  ): Promise<{ token: string; isNewUser: boolean }>;
  bootstrapDriver(): Promise<DriverAccount>;
  getOnboarding(): Promise<DriverOnboardingSummary>;
  logout(): Promise<void>;
  observeAuthState?(callback: (user: User | null) => void): () => void;
  getConfirmation?(): ConfirmationResult | null;
  getRemainingCooldown?(phone?: string): number;
  hasActiveSession?(phone?: string): boolean;
}

export const RESEND_COOLDOWN_SECONDS = DEFAULT_COOLDOWN_SECONDS;

export type DriverApprovalStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED';

/** The backend-owned account state returned by POST /v1/drivers/me. */
export interface DriverAccount {
  readonly driverId: string;
  readonly userId: string;
  readonly phone: string;
  readonly approvalStatus: DriverApprovalStatus;
  readonly legalName: string | null;
  readonly email: string | null;
  readonly vehicleType: string | null;
  readonly vehicleMakeModel: string | null;
  readonly vehicleRegistrationNumber: string | null;
  readonly drivingLicenseNumber: string | null;
  readonly walletBalancePaise: number;
  readonly createdAt: string;
}
const isDriverAccount = (value: unknown): value is DriverAccount => {
  if (!value || typeof value !== 'object') return false;
  const account = value as Record<string, unknown>;
  return (
    typeof account.driverId === 'string' &&
    typeof account.userId === 'string' &&
    typeof account.phone === 'string' &&
    typeof account.approvalStatus === 'string' &&
    typeof account.createdAt === 'string'
  );
};

/** Normalizes and validates Indian phone numbers into E.164 (+91XXXXXXXXXX) format */
export const formatToE164 = (phoneNumber: string): string => {
  const trimmed = phoneNumber.trim();
  const digitsOnly = trimmed.replace(/\D/g, '');

  if (digitsOnly.length === 10) {
    return `+91${digitsOnly}`;
  }
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    return `+${digitsOnly}`;
  }
  if (
    trimmed.startsWith('+') &&
    digitsOnly.length >= 10 &&
    digitsOnly.length <= 15
  ) {
    return `+${digitsOnly}`;
  }
  throw new Error('Please enter a valid 10-digit mobile number.');
};

/** Masks a phone number for logs */
export const maskPhoneNumber = (phone: string): string => {
  if (phone.length <= 4) return '****';
  return phone.slice(0, 3) + '******' + phone.slice(-4);
};

/** Maps Firebase Auth native error codes to user-friendly messages */
export const mapFirebaseAuthError = (error: any): string => {
  const code = error?.code || '';
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'The mobile number entered is invalid.';
    case 'auth/missing-phone-number':
      return 'Mobile number is required.';
    case 'auth/quota-exceeded':
      return 'SMS quota exceeded for today. Please try again later.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few moments before trying again.';
    case 'auth/invalid-verification-code':
      return 'Incorrect OTP. Please enter the 6-digit code received via SMS.';
    case 'auth/code-expired':
      return 'The OTP has expired. Please request a new code.';
    case 'auth/session-expired':
      return 'Verification session has expired. Please request a new OTP.';
    case 'auth/network-request-failed':
      return 'Network connection issue. Please check your internet connection.';
    case 'auth/app-not-authorized':
      return 'This app is not authorized for Firebase phone authentication. Verify SHA fingerprints.';
    case 'auth/captcha-check-failed':
      return 'App verification failed. Please try again.';
    case 'auth/invalid-credential':
      return 'Invalid credentials provided.';
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    default:
      return error?.message || 'Authentication failed. Please try again.';
  }
};

export class FirebaseAuthService implements IAuthService {
  private confirmation: ConfirmationResult | null = null;
  private isRequesting: boolean = false;
  private activePhone: string | null = null;

  getConfirmation(): ConfirmationResult | null {
    return this.confirmation;
  }

  getRemainingCooldown(phone?: string): number {
    const manager = OtpCooldownManager.getInstance();
    if (phone) {
      return manager.getRemaining(phone);
    }
    if (this.activePhone) {
      return manager.getRemaining(this.activePhone);
    }
    return 0;
  }

  hasActiveSession(phone?: string): boolean {
    if (!this.confirmation) return false;
    if (phone) {
      try {
        const formatted = formatToE164(phone);
        return this.activePhone === formatted;
      } catch {
        return false;
      }
    }
    return true;
  }

  async requestOtp(phone: string, forceResend: boolean = false): Promise<void> {
    if (this.isRequesting) {
      console.warn('[AUTH] Duplicate SMS request blocked while in progress');
      throw new Error('Verification request already in progress.');
    }

    const formattedPhone = formatToE164(phone);
    console.log('[AUTH] Phone number validation passed');

    const remaining = this.getRemainingCooldown(formattedPhone);
    if (
      remaining > 0 &&
      !forceResend &&
      this.hasActiveSession(formattedPhone)
    ) {
      console.log(
        `[AUTH] Active session exists within cooldown (${remaining}s remaining), reusing session`,
      );
      return;
    }

    if (remaining > 0 && !forceResend) {
      console.log(
        `[AUTH] Request blocked by cooldown (${remaining}s remaining)`,
      );
      throw new Error(
        `Please wait ${remaining} seconds before requesting another code.`,
      );
    }

    this.isRequesting = true;
    if (forceResend) {
      console.log(
        `[AUTH] Firebase resend request started for ${maskPhoneNumber(
          formattedPhone,
        )}`,
      );
    } else {
      console.log(
        `[AUTH] Firebase SMS request started for ${maskPhoneNumber(
          formattedPhone,
        )}`,
      );
    }

    try {
      const authInstance = getAuth();
      // On React Native Firebase Android, calling (authInstance as any).signInWithPhoneNumber(phone, forceResend)
      // forwards forceResend directly to NativeRNFBTurboAuth.java:
      // PhoneAuthProvider.getInstance(firebaseAuth).verifyPhoneNumber(..., mForceResendingToken)
      const confirmationResult = await (
        authInstance as any
      ).signInWithPhoneNumber(formattedPhone, forceResend);
      this.confirmation = confirmationResult;
      this.activePhone = formattedPhone;
      OtpCooldownManager.getInstance().setCooldown(
        formattedPhone,
        RESEND_COOLDOWN_SECONDS,
      );

      if (forceResend) {
        console.log('[AUTH] Firebase resend request succeeded');
        console.log('[AUTH] Active confirmation result replaced');
      } else {
        console.log('[AUTH] Firebase verification request accepted');
      }
    } catch (e: any) {
      const errorCode = e?.code || e?.message || 'unknown';
      if (errorCode === 'auth/too-many-requests') {
        // Enforce local cooldown lock to prevent repeated requests
        OtpCooldownManager.getInstance().setCooldown(
          formattedPhone,
          RESEND_COOLDOWN_SECONDS,
        );
      }
      if (forceResend) {
        console.warn(`[AUTH] Firebase resend request failed: ${errorCode}`);
      } else {
        console.warn(`[AUTH] Firebase SMS request failed: ${errorCode}`);
      }
      throw new Error(mapFirebaseAuthError(e));
    } finally {
      this.isRequesting = false;
    }
  }

  async verifyOtp(
    phone: string,
    otp: string,
  ): Promise<{ token: string; isNewUser: boolean }> {
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      throw new Error('Please enter a complete 6-digit OTP.');
    }
    if (!this.confirmation) {
      throw new Error(
        'No active verification session. Please request a new OTP.',
      );
    }

    if (phone) {
      try {
        const formatted = formatToE164(phone);
        if (this.activePhone && this.activePhone !== formatted) {
          throw new Error(
            'Verification session does not match this phone number. Please request a new OTP.',
          );
        }
      } catch (err: any) {
        if (err?.message?.includes('Verification session')) {
          throw err;
        }
      }
    }

    console.log('[AUTH] OTP confirmation started');

    try {
      const userCredential = await this.confirmation.confirm(cleanOtp);
      console.log('[AUTH] OTP confirmation succeeded');

      const currentUser = getAuth().currentUser;
      const token = (await currentUser?.getIdToken()) || '';
      if (token) {
        ApiClient.getInstance().setToken(token);
      }

      return {
        token,
        isNewUser: userCredential?.additionalUserInfo?.isNewUser ?? false,
      };
    } catch (e: any) {
      console.warn(
        '[AUTH] Firebase authentication failed:',
        e?.code || e?.message,
      );
      throw new Error(mapFirebaseAuthError(e));
    }
  }

  async loginWithEmail(
    email: string,
    password: string,
  ): Promise<{ token: string; isNewUser: boolean }> {
    try {
      const userCredential = await signInWithEmailAndPassword(
        getAuth(),
        email.trim(),
        password,
      );
      console.log('[AUTH] Firebase email authentication succeeded');

      const token = (await userCredential.user.getIdToken()) || '';
      if (token) {
        ApiClient.getInstance().setToken(token);
      }

      return { token, isNewUser: false };
    } catch (e: any) {
      console.warn(
        '[AUTH] Firebase email login failed:',
        e?.code || e?.message,
      );
      throw new Error(mapFirebaseAuthError(e));
    }
  }

  async signUpWithEmail(
    email: string,
    password: string,
  ): Promise<{ token: string; isNewUser: boolean }> {
    try {
      const userCredential = await createUserWithEmailAndPassword(
        getAuth(),
        email.trim(),
        password,
      );
      console.log('[AUTH] Firebase email sign-up succeeded');

      const token = (await userCredential.user.getIdToken()) || '';
      if (token) {
        ApiClient.getInstance().setToken(token);
      }

      return { token, isNewUser: true };
    } catch (e: any) {
      console.warn(
        '[AUTH] Firebase email signup failed:',
        e?.code || e?.message,
      );
      throw new Error(mapFirebaseAuthError(e));
    }
  }

  async bootstrapDriver(): Promise<DriverAccount> {
    const currentUser = getAuth().currentUser;
    if (!currentUser) {
      throw new Error(
        'Your sign-in session has expired. Please sign in again.',
      );
    }
    if (!env.PAYMENTS_API_BASE_URL) {
      throw new Error(
        'Account service is not configured. Please contact support.',
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.REQUEST_TIMEOUT_MS);
    try {
      const token = await currentUser.getIdToken();
      ApiClient.getInstance().setToken(token);
      const response = await fetch(
        `${env.PAYMENTS_API_BASE_URL}/v1/drivers/me`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        },
      );
      const raw = await response.text();
      let payload: unknown = null;
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch {
          throw new Error('Account service returned an invalid response.');
        }
      }
      if (!response.ok) {
        const error = payload as {
          error?: { message?: unknown };
          message?: unknown;
        } | null;
        const message = error?.error?.message ?? error?.message;
        throw new Error(
          typeof message === 'string'
            ? message
            : 'Could not verify your driver account.',
        );
      }
      if (!isDriverAccount(payload)) {
        throw new Error(
          'Account service returned an incomplete account response.',
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Account verification timed out. Please try again.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async getOnboarding(): Promise<DriverOnboardingSummary> {
    return DriverOnboardingService.getInstance().getSummary();
  }

  async logout(): Promise<void> {
    try {
      await fbSignOut(getAuth());
      this.confirmation = null;
      this.activePhone = null;
      ApiClient.getInstance().setToken(null);
      console.log('[AUTH] Firebase sign-out completed');
    } catch (error) {
      console.warn('[AUTH] Error during sign-out:', error);
      throw error;
    }
  }

  observeAuthState(callback: (user: User | null) => void): () => void {
    return onAuthStateChanged(getAuth(), async (user: User | null) => {
      if (user) {
        console.log('[AUTH] Auth state restored');
        try {
          const token = await user.getIdToken();
          ApiClient.getInstance().setToken(token);
        } catch (e) {
          console.warn('[AUTH] Failed to fetch ID token on auth restore:', e);
        }
      } else {
        console.log('[AUTH] Auth state unauthenticated');
        ApiClient.getInstance().setToken(null);
      }
      callback(user);
    });
  }
}

export class AuthService {
  private static instance: IAuthService;

  static getInstance(): IAuthService {
    if (!AuthService.instance) {
      AuthService.instance = new FirebaseAuthService();
    }
    return AuthService.instance;
  }
}
