import { Platform } from 'react-native';
import {
  getAuth,
  signInWithPhoneNumber,
  signOut as fbSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  GoogleAuthProvider,
  AppleAuthProvider,
  OAuthProvider,
  EmailAuthProvider,
  linkWithCredential,
  type User,
  type ConfirmationResult,
  type UserCredential,
} from '@react-native-firebase/auth';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { appleAuth } from '@invertase/react-native-apple-authentication';
import { OtpCooldownManager, usePhoneCooldown, DEFAULT_COOLDOWN_SECONDS } from './otpCooldownManager';

export const RESEND_COOLDOWN_SECONDS = DEFAULT_COOLDOWN_SECONDS;
export { OtpCooldownManager, usePhoneCooldown };

let currentConfirmationResult: ConfirmationResult | null = null;
let activePhoneNumber: string | null = null;
let isRequestingSms = false;
let isGoogleConfigured = false;

// Web Client ID from google-services.json (client_type: 3)
const GOOGLE_WEB_CLIENT_ID = '702412484863-l9l6scc4qprnv8vok5ptjoomcknvhom7.apps.googleusercontent.com';

const configureGoogleIfNeeded = () => {
  if (!isGoogleConfigured) {
    try {
      GoogleSignin.configure({
        webClientId: GOOGLE_WEB_CLIENT_ID,
        offlineAccess: false,
      });
      isGoogleConfigured = true;
    } catch (e) {
      console.warn('[AUTH] Error configuring Google Sign-In:', e);
    }
  }
};

export const getRemainingCooldown = (phone?: string): number => {
  const manager = OtpCooldownManager.getInstance();
  if (phone) {
    return manager.getRemaining(phone);
  }
  if (activePhoneNumber) {
    return manager.getRemaining(activePhoneNumber);
  }
  return 0;
};

export const hasActiveSession = (phone?: string): boolean => {
  if (!currentConfirmationResult) return false;
  if (phone) {
    try {
      const formatted = formatToE164(phone);
      return activePhoneNumber === formatted;
    } catch {
      return false;
    }
  }
  return true;
};

export const getActivePhoneNumber = (): string | null => activePhoneNumber;

export const setActivePhoneNumber = (phone: string | null): void => {
  if (!phone) {
    activePhoneNumber = null;
    return;
  }
  try {
    activePhoneNumber = formatToE164(phone);
  } catch {
    activePhoneNumber = phone;
  }
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
  if (trimmed.startsWith('+') && digitsOnly.length >= 10 && digitsOnly.length <= 15) {
    return `+${digitsOnly}`;
  }
  throw new Error('Please enter a valid 10-digit mobile number.');
};

/** Normalizes any valid phone string into E.164 format (+91XXXXXXXXXX) safely without throwing */
export const normalizePhoneNumber = (phone?: string | null): string | null => {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  try {
    return formatToE164(trimmed);
  } catch {
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (digitsOnly.length === 10) return `+91${digitsOnly}`;
    if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) return `+${digitsOnly}`;
    if (trimmed.startsWith('+') && digitsOnly.length >= 10 && digitsOnly.length <= 15) return `+${digitsOnly}`;
    return null;
  }
};

/** Masks a phone number for privacy in logs (e.g. +91******1234) */
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
    case 'auth/email-already-in-use':
      return 'An account already exists with this email address. Please use a different email or log in with that account.';
    case 'auth/credential-already-in-use':
      return 'This email is already associated with another account. Please use a different email or log in with that account.';
    case 'auth/provider-already-linked':
      return 'An email and password credential is already linked to this account.';
    case 'auth/requires-recent-login':
      return 'Security verification required. Please log in again before linking a password.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid credentials. Please verify your email and password.';
    case 'auth/user-not-found':
      return 'No account found with this email. Please sign up first.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Please contact support.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled. Please contact support.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled':
      return 'Sign-in was cancelled.';
    default:
      return error?.message || 'Authentication failed. Please try again.';
  }
};

/** Links an Email and Password credential to the currently authenticated Firebase user */
export const linkEmailPassword = async (
  user: User,
  email: string,
  password: string,
): Promise<UserCredential> => {
  const cleanEmail = email.trim();
  if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  const credential = EmailAuthProvider.credential(cleanEmail, password);
  console.log('[AUTH] Linking Email/Password credential to existing user UID:', user.uid);
  try {
    let result: UserCredential;
    if (typeof (user as any).linkWithCredential === 'function') {
      result = await (user as any).linkWithCredential(credential);
    } else {
      result = await linkWithCredential(user, credential);
    }
    console.log('[AUTH] Email/Password linked successfully. Preserved UID:', result.user.uid);
    return result;
  } catch (error: any) {
    console.warn('[AUTH] Email/Password linking failed:', error?.code || error?.message);
    throw error;
  }
};

/** Email sign-up: createUserWithEmailAndPassword */
export const signUpWithEmail = async (
  email: string,
  password: string,
): Promise<UserCredential> => {
  const cleanEmail = email.trim();
  if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password || password.length < 6) {
    throw new Error('Password must be at least 6 characters.');
  }

  try {
    const authInstance = getAuth();
    console.log('[AUTH] Firebase email sign-up started');
    const userCredential = await createUserWithEmailAndPassword(authInstance, cleanEmail, password);
    console.log('[AUTH] Firebase email sign-up succeeded for UID:', userCredential.user.uid);
    return userCredential;
  } catch (error: any) {
    console.warn('[AUTH] Firebase email sign-up failed:', error?.code || error?.message);
    throw error;
  }
};

/** Email login: signInWithEmailAndPassword */
export const signInWithEmail = async (
  email: string,
  password: string,
): Promise<UserCredential> => {
  const cleanEmail = email.trim();
  if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }

  try {
    const authInstance = getAuth();
    console.log('[AUTH] Firebase email log-in started');
    const userCredential = await signInWithEmailAndPassword(authInstance, cleanEmail, password);
    console.log('[AUTH] Firebase email log-in succeeded for UID:', userCredential.user.uid);
    return userCredential;
  } catch (error: any) {
    console.warn('[AUTH] Firebase email log-in failed:', error?.code || error?.message);
    throw error;
  }
};

/** Password reset email: sendPasswordResetEmail */
export const sendPasswordReset = async (email: string): Promise<void> => {
  const cleanEmail = email.trim();
  if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
    throw new Error('Please enter a valid email address.');
  }

  try {
    const authInstance = getAuth();
    console.log('[AUTH] Sending password reset email');
    await sendPasswordResetEmail(authInstance, cleanEmail);
    console.log('[AUTH] Password reset email sent successfully');
  } catch (error: any) {
    console.warn('[AUTH] Password reset email failed:', error?.code || error?.message);
    throw error;
  }
};

/** Google Sign-In with real credential exchange */
export const signInWithGoogle = async (): Promise<UserCredential> => {
  configureGoogleIfNeeded();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    console.log('[AUTH] Google Sign-In prompt started');
    const signInResult: any = await GoogleSignin.signIn();

    // In modern @react-native-google-signin/google-signin versions (v13+), idToken is at data.idToken
    const idToken = signInResult?.data?.idToken || signInResult?.idToken;
    if (!idToken) {
      throw new Error('Could not retrieve Google ID token.');
    }

    const authInstance = getAuth();
    const googleCredential = GoogleAuthProvider.credential(idToken);
    console.log('[AUTH] Exchanging Google credential with Firebase');
    const userCredential = await signInWithCredential(authInstance, googleCredential);
    console.log('[AUTH] Google Sign-In succeeded for UID:', userCredential.user.uid);
    return userCredential;
  } catch (error: any) {
    if (error?.code === statusCodes.SIGN_IN_CANCELLED) {
      console.log('[AUTH] Google Sign-In cancelled by user');
      const cancelErr = new Error('Google Sign-In was cancelled.');
      (cancelErr as any).code = 'auth/cancelled';
      throw cancelErr;
    }
    if (error?.code === statusCodes.IN_PROGRESS) {
      console.log('[AUTH] Google Sign-In already in progress');
      const inProgErr = new Error('Sign-in is already in progress.');
      (inProgErr as any).code = 'auth/in-progress';
      throw inProgErr;
    }
    if (error?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      console.warn('[AUTH] Google Play Services not available');
      const playErr = new Error('Google Play Services is not available or outdated.');
      (playErr as any).code = 'auth/play-services-unavailable';
      throw playErr;
    }
    console.warn('[AUTH] Google Sign-In error:', error?.code || error?.message);
    throw error;
  }
};

/** Apple Sign-In with native iOS and Firebase OAuth provider on Android */
export const signInWithApple = async (): Promise<UserCredential> => {
  const authInstance = getAuth();

  if (Platform.OS === 'ios') {
    if (!appleAuth.isSupported) {
      throw new Error('Apple Sign-In is not supported on this device.');
    }

    try {
      console.log('[AUTH] Starting native Apple Sign-In request on iOS');
      const appleAuthRequestResponse = await appleAuth.performRequest({
        requestedOperation: appleAuth.Operation.LOGIN,
        requestedScopes: [appleAuth.Scope.EMAIL, appleAuth.Scope.FULL_NAME],
      });

      const { identityToken, nonce } = appleAuthRequestResponse;
      if (!identityToken) {
        throw new Error('Apple Sign-In failed - no identity token received.');
      }

      const appleCredential = AppleAuthProvider.credential(identityToken, nonce);
      console.log('[AUTH] Exchanging Apple credential with Firebase');
      const userCredential = await signInWithCredential(authInstance, appleCredential);
      console.log('[AUTH] Apple Sign-In succeeded for UID:', userCredential.user.uid);
      return userCredential;
    } catch (error: any) {
      if (error?.code === appleAuth.Error.CANCELED) {
        console.log('[AUTH] Apple Sign-In cancelled by user');
        const cancelErr = new Error('Apple Sign-In was cancelled.');
        (cancelErr as any).code = 'auth/cancelled';
        throw cancelErr;
      }
      console.warn('[AUTH] Apple Sign-In failed on iOS:', error?.code || error?.message);
      throw error;
    }
  } else {
    // Android: use Firebase OAuthProvider for apple.com
    try {
      console.log('[AUTH] Starting Firebase OAuthProvider Apple sign-in for Android');
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');

      let userCredential: UserCredential;
      if (typeof signInWithPopup === 'function') {
        userCredential = await signInWithPopup(authInstance, provider as any);
      } else {
        userCredential = await signInWithRedirect(authInstance, provider as any);
      }
      console.log('[AUTH] Apple OAuth sign-in succeeded for UID:', userCredential.user.uid);
      return userCredential;
    } catch (error: any) {
      console.warn('[AUTH] Apple Sign-In failed on Android:', error?.code || error?.message);
      throw error;
    }
  }
};

export const sendPhoneOTP = async (
  phoneNumber: string,
  forceResend: boolean = false,
): Promise<ConfirmationResult> => {
  const formattedPhone = formatToE164(phoneNumber);
  console.log('[AUTH] Phone number validation passed');

  if (isRequestingSms) {
    console.warn('[AUTH] Duplicate SMS request blocked while in progress');
    throw new Error('Verification request already in progress.');
  }

  const remaining = getRemainingCooldown(formattedPhone);
  if (remaining > 0 && !forceResend && hasActiveSession(formattedPhone)) {
    console.log(`[AUTH] Active session exists within cooldown (${remaining}s remaining), reusing session`);
    return currentConfirmationResult!;
  }

  if (remaining > 0 && !forceResend) {
    console.log(`[AUTH] Request blocked by cooldown (${remaining}s remaining)`);
    throw new Error(`Please wait ${remaining} seconds before requesting another code.`);
  }

  isRequestingSms = true;
  if (forceResend) {
    console.log('[AUTH] Firebase resend request started');
  } else {
    console.log(`[AUTH] Firebase SMS request started for ${maskPhoneNumber(formattedPhone)}`);
  }

  try {
    const authInstance = getAuth();
    let confirmation: ConfirmationResult;
    if (typeof (authInstance as any).signInWithPhoneNumber === 'function') {
      confirmation = await (authInstance as any).signInWithPhoneNumber(formattedPhone, forceResend);
    } else {
      confirmation = await signInWithPhoneNumber(authInstance, formattedPhone);
    }

    currentConfirmationResult = confirmation;
    activePhoneNumber = formattedPhone;
    OtpCooldownManager.getInstance().setCooldown(formattedPhone, RESEND_COOLDOWN_SECONDS);

    if (forceResend) {
      console.log('[AUTH] Firebase resend request succeeded');
      console.log('[AUTH] Active confirmation result replaced');
    } else {
      console.log('[AUTH] Firebase verification request accepted');
    }

    return currentConfirmationResult;
  } catch (error: any) {
    if (error?.code === 'auth/too-many-requests') {
      // Enforce local cooldown lock to prevent hammering Firebase
      OtpCooldownManager.getInstance().setCooldown(formattedPhone, RESEND_COOLDOWN_SECONDS);
    }
    if (forceResend) {
      console.warn(`[AUTH] Firebase resend request failed: ${error?.code || error?.message}`);
    } else {
      console.warn('[AUTH] Firebase SMS request failed:', error?.code || error?.message);
    }
    throw error;
  } finally {
    isRequestingSms = false;
  }
};

export const verifyOTP = async (otp: string, phoneNumber?: string): Promise<void> => {
  const cleanOtp = otp.trim();
  if (!cleanOtp || cleanOtp.length !== 6) {
    throw new Error('Please enter a complete 6-digit OTP.');
  }
  if (!currentConfirmationResult) {
    throw new Error('No active verification session. Please request a new OTP.');
  }

  if (phoneNumber) {
    try {
      const formatted = formatToE164(phoneNumber);
      if (activePhoneNumber && activePhoneNumber !== formatted) {
        throw new Error('Verification session does not match this phone number. Please request a new OTP.');
      }
    } catch (err: any) {
      if (err?.message?.includes('Verification session')) throw err;
    }
  }

  console.log('[AUTH] OTP confirmation started');
  try {
    await currentConfirmationResult.confirm(cleanOtp);
    if (phoneNumber) {
      try {
        activePhoneNumber = formatToE164(phoneNumber);
      } catch {
        activePhoneNumber = phoneNumber;
      }
    }
    console.log('[AUTH] OTP confirmation succeeded for', activePhoneNumber);
  } catch (error: any) {
    console.warn('[AUTH] OTP confirmation failed:', error?.code || error?.message);
    throw error;
  }
};

export const signOut = async (): Promise<void> => {
  try {
    await fbSignOut(getAuth());
    currentConfirmationResult = null;
    activePhoneNumber = null;
    console.log('[AUTH] Firebase sign-out completed');
  } catch (error) {
    console.warn('[AUTH] Error during sign-out:', error);
    throw error;
  }
};

export const getCurrentUser = (): User | null => {
  return getAuth().currentUser;
};
