import React from 'react';
import { TextInput, Pressable, Text } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import OtpScreen from '../src/screens/auth/OtpVerificationScreen';
import Button from '../src/components/atoms/Button';
import * as auth from '../src/auth/authService';
const mockRetry = jest.fn(async () => undefined);
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({ retryRegistration: mockRetry }) }));
jest.mock('../src/auth/authService', () => ({
  verifyOTP: jest.fn(async () => undefined), sendPhoneOTP: jest.fn(async () => undefined),
  sendPhoneLinkOTP: jest.fn(async () => undefined), confirmPhoneLinkOTP: jest.fn(async () => undefined),
  getPhoneLinkSession: jest.fn(() => ({ verificationId: 'link-id', uid: 'original-google' })),
  hasActiveSession: jest.fn(() => true), usePhoneCooldown: jest.fn(() => ({ cooldownRemaining: 0 })),
  mapFirebaseAuthError: (e: any) => e.message,
}));
let renderer: any;
const navigation = { goBack: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); (auth.usePhoneCooldown as jest.Mock).mockReturnValue({ cooldownRemaining: 0 }); });
afterEach(() => { act(() => renderer?.unmount()); });
async function mount(mode = 'phone') { await act(async () => { renderer = TestRenderer.create(<OtpScreen navigation={navigation}
  route={{ params: { phoneNumber: '+919876543210', authMode: mode } }} />); }); }
const press = (label: string): any => renderer.root.findAll((n: any) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const button = () => renderer.root.findByType(Button);
async function code(value = '123456') { await act(async () => { renderer.root.findByType(TextInput).props.onChangeText(value); }); }
it('accepts pasted/autofilled digits through one accessible input', async () => {
  await mount(); await code('123 456'); expect(renderer.root.findByType(TextInput).props.value).toBe('123456');
  await act(async () => { await button().props.onPress(); });
  expect(auth.verifyOTP).toHaveBeenCalledWith('123456', '+919876543210'); expect(mockRetry).not.toHaveBeenCalled();
});
it('links Google phone credentials without using phone sign-in', async () => {
  await mount('link'); await code(); await act(async () => { await button().props.onPress(); });
  expect(auth.confirmPhoneLinkOTP).toHaveBeenCalledWith('link-id', '123456', 'original-google');
  expect(auth.verifyOTP).not.toHaveBeenCalled(); expect(mockRetry).toHaveBeenCalledTimes(1);
});
it('keeps wrong OTP errors visible and allows another attempt', async () => {
  (auth.verifyOTP as jest.Mock).mockRejectedValueOnce(new Error('Incorrect OTP'));
  await mount(); await code(); await act(async () => { await button().props.onPress(); });
  expect(renderer.root.findAllByType(Text).some((t: any) => t.props.children === 'Incorrect OTP')).toBe(true);
  expect(button().props.disabled).toBe(false);
});
it('blocks resend during cooldown', async () => {
  (auth.usePhoneCooldown as jest.Mock).mockReturnValue({ cooldownRemaining: 25 });
  await mount(); const resend = press('Resend code');
  expect(resend.props.disabled).toBe(true); await act(async () => { await resend.props.onPress(); });
  expect(auth.sendPhoneOTP).not.toHaveBeenCalled();
});
it('resends in the same Google linking flow and clears the old code', async () => {
  await mount('link'); await code();
  await act(async () => { await press('Resend code').props.onPress(); });
  expect(auth.sendPhoneLinkOTP).toHaveBeenCalledWith('+919876543210', true);
  expect(auth.sendPhoneOTP).not.toHaveBeenCalled(); expect(renderer.root.findByType(TextInput).props.value).toBe('');
});
it('edit number returns to the existing entry screen', async () => {
  await mount(); await act(async () => { press('Edit mobile number').props.onPress(); });
  expect(navigation.goBack).toHaveBeenCalledTimes(1);
});

