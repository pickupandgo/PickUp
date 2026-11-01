import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import PhoneCompletionScreen from '../src/screens/auth/PhoneCompletionScreen';
import Button from '../src/components/atoms/Button';
import * as auth from '../src/auth/authService';
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({ logout: jest.fn(), retryRegistration: jest.fn() }) }));
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: {
  uid: 'google-A', phoneNumber: null, providerData: [{ providerId: 'google.com' }],
} }) }));
jest.mock('../src/auth/authService', () => ({
  sendPhoneLinkOTP: jest.fn(async () => ({ verificationId: 'id', uid: 'google-A' })),
  getPhoneLinkSession: jest.fn(() => null), usePhoneCooldown: () => ({ cooldownRemaining: 0 }),
  mapFirebaseAuthError: (e: any) => e.message,
}));
it('accepts a typed mobile after Google and starts linking OTP, preserving its auth mode', async () => {
  const navigation = { navigate: jest.fn() };
  let renderer: any;
  await act(async () => { renderer = TestRenderer.create(<PhoneCompletionScreen navigation={navigation} />); });
  expect(renderer.root.findByType(TextInput).props.editable).toBe(true);
  await act(async () => { renderer.root.findByType(TextInput).props.onChangeText('9876543210'); });
  await act(async () => { await renderer.root.findByType(Button).props.onPress(); });
  expect(auth.sendPhoneLinkOTP).toHaveBeenCalledWith('+919876543210');
  expect(navigation.navigate).toHaveBeenCalledWith('OtpVerificationScreen', { phoneNumber: '+919876543210', authMode: 'link' });
  act(() => renderer.unmount());
});

