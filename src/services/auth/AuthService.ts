import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiClient } from '../api/ApiClient';
import type { DriverProfile } from '../../types/user';
import { saveDriverVehicleProfile } from '../../state/vehicle';
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
import { OtpCooldownManager, usePhoneCooldown, DEFAULT_COOLDOWN_SECONDS } from './OtpCooldownManager';
import { floatingBubbleService } from '../overlay/FloatingBubbleService';

export type { User, ConfirmationResult };
export { OtpCooldownManager, usePhoneCooldown };

export const PROFILE_CACHE_KEY_PREFIX = 'driver.cachedProfile';

export interface IAuthService {
  requestOtp(phone: string, forceResend?: boolean): Promise<void>;
  verifyOtp(phone: string, otp: string): Promise<{ token: string; isNewUser: boolean }>;
  loginWithEmail(email: string, password: string): Promise<{ token: string; isNewUser: boolean }>;
  signUpWithEmail(email: string, password: string): Promise<{ token: string; isNewUser: boolean }>;
  registerDriver(data: {
    name: string;
    phone: string;
    email?: string;
    vehicleType?: string;
    vehicleMake?: string;
    vehicleMakeModel?: string;
    licensePlate?: string;
    vehicleRegistrationNumber?: string;
    drivingLicenseNumber?: string;
  }): Promise<any>;
  completeOnboarding(vehicleId: string, language: string): Promise<{ driver: DriverProfile }>;
  getProfile(): Promise<DriverProfile>;
  fetchDriverProfile(options?: { forceRefresh?: boolean }): Promise<any>;
  getCachedProfile?(): any;
  loadCachedProfile?(uid: string): Promise<any>;
  logout(): Promise<void>;
  observeAuthState?(callback: (user: User | null) => void): () => void;
  observeProfileState?(callback: (profile: any) => void): () => void;
  notifyProfileChanged?(profile: any): void;
  getConfirmation?(): ConfirmationResult | null;
  getRemainingCooldown?(phone?: string): number;
  hasActiveSession?(phone?: string): boolean;
}

export const RESEND_COOLDOWN_SECONDS = DEFAULT_COOLDOWN_SECONDS;

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

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
  if (trimmed.startsWith('+') && digitsOnly.length >= 10 && digitsOnly.length <= 15) {
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
  private profileListeners: Set<(profile: any) => void> = new Set();
  private cachedProfile: any = null;
  private inFlightProfilePromise: Promise<any> | null = null;

  getCachedProfile(): any {
    return this.cachedProfile;
  }

  async loadCachedProfile(uid: string): Promise<any> {
    if (this.cachedProfile) {
      return this.cachedProfile;
    }
    try {
      const raw = await AsyncStorage.getItem(`${PROFILE_CACHE_KEY_PREFIX}.${uid}`);
      if (raw) {
        this.cachedProfile = JSON.parse(raw);
        return this.cachedProfile;
      }
    } catch {
      // non-fatal
    }
    return null;
  }

  observeProfileState(callback: (profile: any) => void): () => void {
    this.profileListeners.add(callback);
    return () => this.profileListeners.delete(callback);
  }

  notifyProfileChanged(profile: any): void {
    this.cachedProfile = profile;
    const uid = getAuth().currentUser?.uid;
    if (uid) {
      if (profile) {
        AsyncStorage.setItem(`${PROFILE_CACHE_KEY_PREFIX}.${uid}`, JSON.stringify(profile)).catch(() => {});
      } else {
        AsyncStorage.removeItem(`${PROFILE_CACHE_KEY_PREFIX}.${uid}`).catch(() => {});
      }
    }
    for (const listener of this.profileListeners) {
      try {
        listener(profile);
      } catch (err) {
        console.warn('[AUTH] Error in profile listener:', err);
      }
    }
  }

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
    if (remaining > 0 && !forceResend && this.hasActiveSession(formattedPhone)) {
      console.log(`[AUTH] Active session exists within cooldown (${remaining}s remaining), reusing session`);
      return;
    }

    if (remaining > 0 && !forceResend) {
      console.log(`[AUTH] Request blocked by cooldown (${remaining}s remaining)`);
      throw new Error(`Please wait ${remaining} seconds before requesting another code.`);
    }

    this.isRequesting = true;
    if (forceResend) {
      console.log(`[AUTH] Firebase resend request started for ${maskPhoneNumber(formattedPhone)}`);
    } else {
      console.log(`[AUTH] Firebase SMS request started for ${maskPhoneNumber(formattedPhone)}`);
    }

    try {
      const authInstance = getAuth();
      // On React Native Firebase Android, calling (authInstance as any).signInWithPhoneNumber(phone, forceResend)
      // forwards forceResend directly to NativeRNFBTurboAuth.java:
      // PhoneAuthProvider.getInstance(firebaseAuth).verifyPhoneNumber(..., mForceResendingToken)
      const confirmationResult = await (authInstance as any).signInWithPhoneNumber(
        formattedPhone,
        forceResend,
      );
      this.confirmation = confirmationResult;
      this.activePhone = formattedPhone;
      OtpCooldownManager.getInstance().setCooldown(formattedPhone, RESEND_COOLDOWN_SECONDS);

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
        OtpCooldownManager.getInstance().setCooldown(formattedPhone, RESEND_COOLDOWN_SECONDS);
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

  async verifyOtp(phone: string, otp: string): Promise<{ token: string; isNewUser: boolean }> {
    const cleanOtp = otp.trim();
    if (cleanOtp.length !== 6) {
      throw new Error('Please enter a complete 6-digit OTP.');
    }
    if (!this.confirmation) {
      throw new Error('No active verification session. Please request a new OTP.');
    }

    if (phone) {
      try {
        const formatted = formatToE164(phone);
        if (this.activePhone && this.activePhone !== formatted) {
          throw new Error('Verification session does not match this phone number. Please request a new OTP.');
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
      console.warn('[AUTH] Firebase authentication failed:', e?.code || e?.message);
      throw new Error(mapFirebaseAuthError(e));
    }
  }

  async loginWithEmail(email: string, password: string): Promise<{ token: string; isNewUser: boolean }> {
    try {
      const userCredential = await signInWithEmailAndPassword(getAuth(), email.trim(), password);
      console.log('[AUTH] Firebase email authentication succeeded');

      const token = (await userCredential.user.getIdToken()) || '';
      if (token) {
        ApiClient.getInstance().setToken(token);
      }

      return { token, isNewUser: false };
    } catch (e: any) {
      console.warn('[AUTH] Firebase email login failed:', e?.code || e?.message);
      throw new Error(mapFirebaseAuthError(e));
    }
  }

  async signUpWithEmail(email: string, password: string): Promise<{ token: string; isNewUser: boolean }> {
    try {
      const userCredential = await createUserWithEmailAndPassword(getAuth(), email.trim(), password);
      console.log('[AUTH] Firebase email sign-up succeeded');

      const token = (await userCredential.user.getIdToken()) || '';
      if (token) {
        ApiClient.getInstance().setToken(token);
      }

      return { token, isNewUser: true };
    } catch (e: any) {
      console.warn('[AUTH] Firebase email signup failed:', e?.code || e?.message);
      throw new Error(mapFirebaseAuthError(e));
    }
  }

  async completeOnboarding(vehicleId: string, language: string): Promise<{ driver: DriverProfile }> {
    await delay(500);
    const currentUser = getAuth().currentUser;
    const phone = currentUser?.phoneNumber || this.activePhone || '';
    const name = currentUser?.displayName || (phone ? `Driver (${phone})` : 'Driver');
    return {
      driver: {
        id: currentUser?.uid || '',
        name,
        phone,
        location: '',
        profileCompletionPercent: 100,
        status: 'offline',
        language,
      },
    };
  }

  async registerDriver(data: {
    name: string;
    phone: string;
    email?: string;
    vehicleType?: string;
    vehicleMake?: string;
    vehicleMakeModel?: string;
    licensePlate?: string;
    vehicleRegistrationNumber?: string;
    drivingLicenseNumber?: string;
  }): Promise<any> {
    const formattedPhone = formatToE164(data.phone);
    console.log(`[AUTH] Registering driver with backend for phone: ${maskPhoneNumber(formattedPhone)}`);

    const currentUser = getAuth().currentUser;
    if (currentUser) {
      try {
        const token = await currentUser.getIdToken(true);
        if (token) {
          ApiClient.getInstance().setToken(token);
        }
      } catch (tokenErr) {
        console.warn('[AUTH] Failed to refresh Firebase token prior to registration:', tokenErr);
      }
    }

    const payload = {
      name: data.name.trim(),
      phone: formattedPhone,
      email: data.email?.trim() || undefined,
      vehicleType: data.vehicleType?.trim() || undefined,
      vehicleMakeModel: (data.vehicleMakeModel || data.vehicleMake)?.trim() || undefined,
      vehicleRegistrationNumber: (data.vehicleRegistrationNumber || data.licensePlate)?.trim().toUpperCase() || undefined,
      drivingLicenseNumber: data.drivingLicenseNumber?.trim().toUpperCase() || undefined,
    };

    const response = await ApiClient.getInstance().post<any>('/v1/drivers/me', payload);
    console.log('[AUTH] Backend driver registration response received:', response);
    this.notifyProfileChanged(response);

    if (data.vehicleType) {
      await saveDriverVehicleProfile(currentUser?.uid ?? 'driver', {
        vehicleType: data.vehicleType,
        vehicleRegistrationNumber: payload.vehicleRegistrationNumber || '',
        vehicleMakeModel: payload.vehicleMakeModel || '',
        drivingLicenseNumber: payload.drivingLicenseNumber || '',
        updatedAt: new Date().toISOString(),
      });
    }

    return response;
  }

  async fetchDriverProfile(options?: { forceRefresh?: boolean }): Promise<any> {
    if (!options?.forceRefresh && this.inFlightProfilePromise) {
      return this.inFlightProfilePromise;
    }

    this.inFlightProfilePromise = (async () => {
      const currentUser = getAuth().currentUser;
      if (currentUser) {
        try {
          const token = await currentUser.getIdToken();
          if (token) {
            ApiClient.getInstance().setToken(token);
          }
        } catch (tokenErr) {
          console.warn('[AUTH] Token fetch for profile failed:', tokenErr);
        }
      }
      try {
        const profile = await ApiClient.getInstance().get<any>('/v1/drivers/me');
        this.notifyProfileChanged(profile);
        return profile;
      } catch (err: any) {
        if (err?.statusCode === 403 || err?.statusCode === 404 || err?.code === 'DRIVER_NOT_FOUND') {
          this.notifyProfileChanged(null);
          return null;
        }
        throw err;
      } finally {
        this.inFlightProfilePromise = null;
      }
    })();

    return this.inFlightProfilePromise;
  }

  async getProfile(): Promise<DriverProfile> {
    const currentUser = getAuth().currentUser;
    const phone = currentUser?.phoneNumber || this.activePhone || '';
    let name = currentUser?.displayName || (phone ? `Driver (${phone})` : 'Driver');
    let profileCompletionPercent = 0;
    let status: any = 'offline';

    try {
      const backendProfile = await this.fetchDriverProfile();
      if (backendProfile) {
        name = backendProfile.legalName || name;
        if (backendProfile.approvalStatus === 'APPROVED') {
          profileCompletionPercent = 100;
          status = 'offline';
        } else if (backendProfile.approvalStatus === 'PENDING' || backendProfile.approvalStatus === 'UNDER_REVIEW') {
          profileCompletionPercent = 70;
          status = 'restricted';
        } else {
          profileCompletionPercent = 30;
          status = 'restricted';
        }
      }
    } catch (e: any) {
      console.log('[AUTH] Backend driver profile fetch bypassed:', e?.message);
    }

    return {
      id: currentUser?.uid || '',
      name,
      phone,
      location: '',
      profileCompletionPercent,
      status,
      language: 'en',
    };
  }

  async logout(): Promise<void> {
    try {
      await fbSignOut(getAuth());
      this.confirmation = null;
      this.activePhone = null;
      this.cachedProfile = null;
      this.inFlightProfilePromise = null;
      const uid = getAuth().currentUser?.uid;
      if (uid) {
        AsyncStorage.removeItem(`${PROFILE_CACHE_KEY_PREFIX}.${uid}`).catch(() => {});
      }
      ApiClient.getInstance().setToken(null);
      this.notifyProfileChanged(null);
      floatingBubbleService.syncDriverState(false).catch(() => {});
      floatingBubbleService.hideBubble().catch(() => {});
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

  static async fetchDriverProfile(options?: { forceRefresh?: boolean }): Promise<any> {
    return AuthService.getInstance().fetchDriverProfile(options);
  }

  static getCachedProfile(): any {
    const instance = AuthService.getInstance();
    return instance.getCachedProfile ? instance.getCachedProfile() : null;
  }

  static async loadCachedProfile(uid: string): Promise<any> {
    const instance = AuthService.getInstance();
    return instance.loadCachedProfile ? instance.loadCachedProfile(uid) : null;
  }

  static observeProfileState(callback: (profile: any) => void): () => void {
    const instance = AuthService.getInstance();
    if (instance.observeProfileState) {
      return instance.observeProfileState(callback);
    }
    return () => {};
  }
}
