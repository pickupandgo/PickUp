import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { SessionProvider, useSession } from '../src/state/SessionContext';
import { fetchUserProfileApi, saveUserProfileApi } from '../src/api/userProfile';
import { registerCustomer } from '../src/api/payments';
import { ApiError } from '../src/api/http';
import { signOut } from '../src/auth/authService';
import { setProfileComplete } from '../src/state/session';

let mockUser: any;
let mockAuthListener: (user: any) => void;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockUser }),
  onAuthStateChanged: (_auth: any, callback: any) => { mockAuthListener = callback; return jest.fn(); },
}));
jest.mock('../src/config/env', () => ({ hasPaymentsConfig: () => true }));
jest.mock('../src/api/payments', () => ({ registerCustomer: jest.fn(async () => undefined) }));
jest.mock('../src/api/userProfile', () => ({ fetchUserProfileApi: jest.fn(), saveUserProfileApi: jest.fn() }));
jest.mock('../src/auth/authService', () => ({ signOut: jest.fn(async () => { mockUser = null; mockAuthListener(null); }) }));
jest.mock('../src/state/session', () => ({
  setProfileComplete: jest.fn(async () => undefined), clearSession: jest.fn(async () => undefined),
}));
const complete = { uid: 'backend-customer-id', fullName: 'Chosen name', email: 'chosen@example.com',
  phone: '+919876543210', age: '29', address: 'Jaipur' };
let api: ReturnType<typeof useSession>;
let renderer: ReactTestRenderer;
function Capture() { api = useSession(); return null; }
async function emit(user: any) { await act(async () => { mockUser = user; mockAuthListener(user); }); }
beforeEach(async () => {
  jest.clearAllMocks(); mockUser = { uid: 'firebase-A', phoneNumber: complete.phone };
  (fetchUserProfileApi as jest.Mock).mockResolvedValue(complete);
  (saveUserProfileApi as jest.Mock).mockResolvedValue(complete);
  await act(async () => { renderer = TestRenderer.create(<SessionProvider><Capture /></SessionProvider>); });
});
afterEach(() => { act(() => renderer.unmount()); });
it('restores a complete backend profile before admitting a returning account', async () => {
  await emit(mockUser); expect(api.registrationStatus).toBe('ready'); expect(api.hasProfile).toBe(true);
  expect(api.userProfile?.fullName).toBe('Chosen name'); expect(registerCustomer).toHaveBeenCalledTimes(1);
});
it('routes a Google-only account to phone completion before backend registration', async () => {
  await emit({ uid: 'google-A', phoneNumber: null, displayName: 'Google name' });
  expect(api.registrationStatus).toBe('needs_phone'); expect(registerCustomer).not.toHaveBeenCalled();
});
it('requires missing age/address on existing profiles', async () => {
  (fetchUserProfileApi as jest.Mock).mockResolvedValue({ ...complete, age: undefined, address: '' });
  await emit(mockUser); expect(api.registrationStatus).toBe('needs_profile'); expect(api.hasProfile).toBe(false);
  expect(api.userProfile?.fullName).toBe('Chosen name');
});
it('uses a recovery state for offline registration rather than pretending profile is missing', async () => {
  (registerCustomer as jest.Mock).mockRejectedValueOnce(new ApiError('network', 'offline'));
  await emit(mockUser); expect(api.registrationStatus).toBe('error'); expect(api.registrationError).toContain('connection');
});
it.each(['PHONE_ALREADY_REGISTERED', 'ACCOUNT_ROLE_CONFLICT', 'ACCOUNT_DISABLED'])('blocks %s truthfully', async errorCode => {
  (registerCustomer as jest.Mock).mockRejectedValueOnce(new ApiError('http', 'blocked', 409, { error: { code: errorCode } }));
  await emit(mockUser); expect(api.registrationStatus).toBe('blocked'); expect(api.hasProfile).toBe(false);
});
it('requires server-confirmed complete fields and retains failed-save state', async () => {
  await emit(mockUser);
  (saveUserProfileApi as jest.Mock).mockRejectedValueOnce(new ApiError('network', 'offline'));
  await expect(api.markProfileDone(complete)).rejects.toMatchObject({ kind: 'network' });
  expect(api.userProfile?.fullName).toBe('Chosen name');
  await expect(api.markProfileDone({ ...complete, age: '' })).rejects.toThrow('required');
  (saveUserProfileApi as jest.Mock).mockResolvedValueOnce({ ...complete, address: '' });
  await expect(api.markProfileDone(complete)).rejects.toThrow('server did not save');
});
it('preserves a previously confirmed profile during a transient refresh failure', async () => {
  await emit(mockUser);
  (fetchUserProfileApi as jest.Mock).mockRejectedValueOnce(new ApiError('network', 'offline'));
  await act(async () => { await api.refreshProfile(); });
  expect(api.hasProfile).toBe(true); expect(api.registrationStatus).toBe('ready');
  expect(api.registrationError).toContain('connection');
});
it('ignores late registration results after switching accounts', async () => {
  let finish!: (value: any) => void;
  (fetchUserProfileApi as jest.Mock).mockImplementationOnce(() => new Promise(r => { finish = r; }));
  await emit(mockUser);
  await emit({ uid: 'google-B', phoneNumber: null });
  await act(async () => { finish(complete); });
  expect(api.authUid).toBe('google-B'); expect(api.registrationStatus).toBe('needs_phone'); expect(api.userProfile).toBeNull();
});
it('routes a confirmed disabled account to recovery on profile refresh', async () => {
  await emit(mockUser);
  (fetchUserProfileApi as jest.Mock).mockRejectedValueOnce(new ApiError('http', 'disabled', 403,
    { error: { code: 'ACCOUNT_DISABLED', message: 'This account is disabled' } }));
  await act(async () => { await api.refreshProfile(); });
  expect(api.hasProfile).toBe(false); expect(api.registrationStatus).toBe('blocked');
});
it('ignores late save responses after logout', async () => {
  await emit(mockUser);
  let finish!: (value: any) => void;
  (saveUserProfileApi as jest.Mock).mockImplementationOnce(() => new Promise(r => { finish = r; }));
  let result!: Promise<any>;
  await act(async () => { result = api.markProfileDone(complete).catch(e => e); });
  await act(async () => { await api.logout(); });
  const callsAfterLogout = (setProfileComplete as jest.Mock).mock.calls.length;
  await act(async () => { finish(complete); await result; });
  expect(await result).toBeInstanceOf(Error); expect(api.isLoggedIn).toBe(false); expect(api.userProfile).toBeNull();
  expect(setProfileComplete).toHaveBeenCalledTimes(callsAfterLogout); expect(signOut).toHaveBeenCalledTimes(1);
});
it('coalesces registration retries and keeps one backend operation in flight', async () => {
  let finish!: () => void;
  (registerCustomer as jest.Mock).mockImplementationOnce(() => new Promise<void>(r => { finish = r; }));
  let first!: Promise<void>; let second!: Promise<void>;
  await act(async () => { first = api.retryRegistration(); second = api.retryRegistration(); });
  expect(first).toBe(second); expect(registerCustomer).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); await first; });
  expect(api.registrationStatus).toBe('ready');
});



it('aborts old profile requests when the Firebase account changes', async () => {
  let signal: AbortSignal | undefined;
  (fetchUserProfileApi as jest.Mock).mockImplementationOnce((s: AbortSignal) => {
    signal = s;
    return new Promise(() => {});
  });
  await emit(mockUser);
  expect(signal?.aborted).toBe(false);
  await emit({ uid: 'firebase-B', phoneNumber: complete.phone });
  expect(signal?.aborted).toBe(true);
  expect(api.authUid).toBe('firebase-B');
});
