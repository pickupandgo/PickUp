import { confirmPhoneLinkOTP, sendPhoneLinkOTP, signOut, OtpCooldownManager, signInWithGoogle } from '../src/auth/authService';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { getAuth, linkWithCredential, PhoneAuthProvider, signOut as firebaseSignOut } from '@react-native-firebase/auth';

jest.mock('@react-native-firebase/auth', () => {
  const provider: any = jest.fn().mockImplementation(() => ({ verifyPhoneNumber: jest.fn(async () => 'verification-id') }));
  provider.credential = jest.fn(() => ({ providerId: 'phone' }));
  return {
    getAuth: jest.fn(),
    PhoneAuthProvider: provider,
    linkWithCredential: jest.fn(),
    signOut: jest.fn(async () => undefined),
  };
});

const currentUser = { uid: 'google-uid', phoneNumber: null as string | null, getIdToken: jest.fn(async () => 'new-token') };

beforeEach(() => {
  jest.clearAllMocks();
  currentUser.phoneNumber = null;
  (getAuth as jest.Mock).mockReturnValue({ currentUser });
});
afterEach(() => { OtpCooldownManager.getInstance().clearCooldown('+919876543210'); });

it('links a verified phone to the existing Google UID', async () => {
  const session = await sendPhoneLinkOTP('9876543210');
  expect(session).toEqual({ verificationId: 'verification-id', uid: 'google-uid' });
  const linkedUser = { ...currentUser, phoneNumber: '+919876543210' };
  (linkWithCredential as jest.Mock).mockResolvedValue({ user: linkedUser });
  const phone = await confirmPhoneLinkOTP(session.verificationId, '123456', session.uid);
  expect(phone).toBe('+919876543210');
  expect(PhoneAuthProvider.credential).toHaveBeenCalledWith('verification-id', '123456');
  expect(linkWithCredential).toHaveBeenCalledWith(currentUser, { providerId: 'phone' });
  expect(linkedUser.getIdToken).toHaveBeenCalledWith(true);
});

it('stops when the signed-in UID changes before OTP confirmation', async () => {
  await expect(confirmPhoneLinkOTP('verification-id', '123456', 'different-uid'))
    .rejects.toThrow('sign-in changed');
  expect(linkWithCredential).not.toHaveBeenCalled();
});

it('surfaces a phone credential collision without switching accounts', async () => {
  (linkWithCredential as jest.Mock).mockRejectedValue({ code: 'auth/credential-already-in-use' });
  await expect(confirmPhoneLinkOTP('verification-id', '123456', 'google-uid'))
    .rejects.toMatchObject({ code: 'auth/credential-already-in-use' });
  expect(currentUser.uid).toBe('google-uid');
});

it('allows logout when Firebase has already cleared the current user', async () => {
  (getAuth as jest.Mock).mockReturnValue({ currentUser: null });
  await expect(signOut()).resolves.toBeUndefined();
  expect(firebaseSignOut).not.toHaveBeenCalled();
});

it('allows logout if Firebase clears the user during sign-out', async () => {
  (firebaseSignOut as jest.Mock).mockRejectedValueOnce({ code: 'auth/no-current-user' });
  await expect(signOut()).resolves.toBeUndefined();
});

it('treats the current Google SDK cancelled result as user cancellation', async () => {
  (GoogleSignin.signIn as jest.Mock).mockResolvedValueOnce({ type: 'cancelled', data: null });
  await expect(signInWithGoogle()).rejects.toMatchObject({ code: 'auth/cancelled' });
});
