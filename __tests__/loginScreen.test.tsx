import React from 'react';
import { TextInput, Text, Pressable } from 'react-native';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import LoginScreen from '../src/screens/auth/LoginScreen';
import Button from '../src/components/atoms/Button';
import * as auth from '../src/auth/authService';
jest.mock('../src/auth/authService', () => ({
  sendPhoneOTP: jest.fn(async () => undefined), signInWithGoogle: jest.fn(async () => undefined),
  mapFirebaseAuthError: (e: any) => e.message, hasActiveSession: jest.fn(() => false),
  usePhoneCooldown: jest.fn(() => ({ cooldownRemaining: 0 })),
}));
let renderer: any;
const navigation = { navigate: jest.fn() };
beforeEach(() => { jest.clearAllMocks(); (auth.hasActiveSession as jest.Mock).mockReturnValue(false);
  (auth.usePhoneCooldown as jest.Mock).mockReturnValue({ cooldownRemaining: 0 }); });
afterEach(() => { act(() => renderer?.unmount()); });
async function mount() { await act(async () => { renderer = TestRenderer.create(<LoginScreen navigation={navigation} />); }); }
const press = (label: string): any => renderer.root.findAll((n: any) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const button = () => renderer.root.findByType(Button);
const text = () => renderer.root.findAllByType(Text).map((t: any) => t.props.children).flat().join(' ');
it('uses one entry for new and existing customers without login/signup switching', async () => {
  await mount(); expect(text()).toContain('Let’s get moving'); expect(text()).not.toContain('Sign Up');
  expect(button().props.disabled).toBe(true);
});
it('normalizes a pasted country code and opens the shared OTP flow', async () => {
  await mount(); await act(async () => { renderer.root.findByType(TextInput).props.onChangeText('+91 98765 43210'); });
  await act(async () => { await button().props.onPress(); });
  expect(auth.sendPhoneOTP).toHaveBeenCalledWith('+919876543210');
  expect(navigation.navigate).toHaveBeenCalledWith('OtpVerificationScreen', { phoneNumber: '+919876543210', authMode: 'phone' });
});
it('allows resuming an active OTP session during cooldown', async () => {
  (auth.usePhoneCooldown as jest.Mock).mockReturnValue({ cooldownRemaining: 24 });
  (auth.hasActiveSession as jest.Mock).mockReturnValue(true);
  await mount(); await act(async () => { renderer.root.findByType(TextInput).props.onChangeText('9876543210'); });
  expect(button().props.label).toBe('Continue verification'); expect(button().props.disabled).toBe(false);
  await act(async () => { await button().props.onPress(); });
  expect(auth.sendPhoneOTP).not.toHaveBeenCalled();
});
it('blocks a new SMS while cooldown exists without a resumable session', async () => {
  (auth.usePhoneCooldown as jest.Mock).mockReturnValue({ cooldownRemaining: 24 });
  await mount(); await act(async () => { renderer.root.findByType(TextInput).props.onChangeText('9876543210'); });
  expect(button().props.disabled).toBe(true);
});
it('shows SMS failures without navigating', async () => {
  (auth.sendPhoneOTP as jest.Mock).mockRejectedValueOnce(new Error('offline'));
  await mount(); await act(async () => { renderer.root.findByType(TextInput).props.onChangeText('9876543210'); });
  await act(async () => { await button().props.onPress(); });
  expect(text()).toContain('offline'); expect(navigation.navigate).not.toHaveBeenCalled();
});
it('prevents two phone/Google operations from starting together', async () => {
  let finish!: () => void;
  (auth.sendPhoneOTP as jest.Mock).mockImplementationOnce(() => new Promise<void>(r => { finish = r; }));
  await mount(); await act(async () => { renderer.root.findByType(TextInput).props.onChangeText('9876543210'); });
  let request: Promise<void>;
  await act(async () => { request = button().props.onPress(); button().props.onPress();
    press('Continue with Google').props.onPress(); });
  expect(auth.sendPhoneOTP).toHaveBeenCalledTimes(1); expect(auth.signInWithGoogle).not.toHaveBeenCalled();
  await act(async () => { finish(); await request; });
});
it('starts Google authentication without manually navigating to a second login', async () => {
  await mount(); await act(async () => { await press('Continue with Google').props.onPress(); });
  expect(auth.signInWithGoogle).toHaveBeenCalledTimes(1); expect(navigation.navigate).not.toHaveBeenCalled();
});

