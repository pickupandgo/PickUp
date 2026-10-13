import { getAuth, getIdToken } from '@react-native-firebase/auth';
import { PaymentsApiError } from './paymentsErrors';

/**
 * The signed-in driver's Firebase ID token for the payments backend. The SDK caches it and
 * refreshes it when it is close to expiry; `forceRefresh` fetches a new one.
 */
export async function getFirebaseIdToken(
  forceRefresh: boolean,
): Promise<string> {
  const user = getAuth().currentUser;
  if (!user) {
    throw new PaymentsApiError('NOT_SIGNED_IN', 'Not signed in', 401);
  }
  return getIdToken(user, forceRefresh);
}

/** The signed-in driver's phone number, used only to prefill Razorpay Checkout. */
export function getSignedInPhoneNumber(): string | undefined {
  return getAuth().currentUser?.phoneNumber ?? undefined;
}
