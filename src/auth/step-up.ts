import type { AuthSession } from './principal';

/** The only step-up method in V1: re-authenticating with Firebase phone OTP. */
export const STEP_UP_METHOD = 'FIREBASE_PHONE_REAUTH';

/** Why a token is not a valid step-up. Returned to the app so it can prompt the right action. */
export type StepUpProblem =
  /** The token did not come from a phone OTP sign-in. */
  | 'NOT_PHONE_SIGN_IN'
  /** The verified phone is missing or is not the account's registered phone. */
  | 'PHONE_MISMATCH'
  /** The sign-in happened before the challenge: the app must re-authenticate with an OTP. */
  | 'REAUTHENTICATION_REQUIRED';

/**
 * A step-up proves the caller signed in again, with an OTP sent to the account's registered
 * phone, AFTER `challengeCreatedAt`. A Firebase ID token's `auth_time` is the time of the last
 * real sign-in: refreshing the token (all a stolen refresh token or ID token allows) never moves
 * it, so a hijacked session alone cannot pass, however recently the victim signed in.
 *
 * `auth_time` has whole seconds; requiring it to be strictly after the challenge's millisecond
 * timestamp means a sign-in in the same second as the challenge never counts.
 */
export function checkStepUp(
  session: AuthSession,
  registeredPhone: string,
  challengeCreatedAt: Date,
): StepUpProblem | null {
  if (session.signInProvider !== 'phone') {
    return 'NOT_PHONE_SIGN_IN';
  }
  if (session.phoneNumber === null || session.phoneNumber !== registeredPhone) {
    return 'PHONE_MISMATCH';
  }
  if (
    session.authenticatedAt === null ||
    session.authenticatedAt.getTime() <= challengeCreatedAt.getTime()
  ) {
    return 'REAUTHENTICATION_REQUIRED';
  }
  return null;
}

/** "+919876543210" -> "+91******3210": enough for the driver to recognise the number. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) {
    return '*'.repeat(phone.length);
  }
  return `${phone.slice(0, 3)}${'*'.repeat(phone.length - 7)}${phone.slice(-4)}`;
}
