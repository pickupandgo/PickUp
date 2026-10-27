import React from 'react';
import { TextInput } from 'react-native';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import OtpVerificationScreen from '../src/screens/auth/OtpVerificationScreen';
import Button from '../src/components/atoms/Button';

// Mock authService
jest.mock('../src/auth/authService', () => ({
  verifyOTP: jest.fn().mockResolvedValue({ user: { uid: 'user-123' } }),
  sendPhoneOTP: jest.fn().mockResolvedValue('mock-verification-id'),
  mapFirebaseAuthError: jest.fn((e: any) => e?.message || 'Authentication error'),
  RESEND_COOLDOWN_SECONDS: 60,
  usePhoneCooldown: jest.fn(() => ({ cooldownRemaining: 0, isCoolingDown: false })),
}));

// Mock session
jest.mock('../src/state/session', () => ({
  clearProfileComplete: jest.fn().mockResolvedValue(undefined),
}));

// Mock vector icons
jest.mock('react-native-vector-icons/Feather', () => 'Feather');
jest.mock('react-native-vector-icons/MaterialIcons', () => 'MaterialIcons');

describe('OtpVerificationScreen - Multi-digit paste & Verify button styling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('automatically distributes a pasted 6-digit code across all 6 blocks 1-by-1', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <OtpVerificationScreen route={{ params: { phoneNumber: '+919999999999' } }} />
      );
    });

    const inputs = renderer?.root.findAllByType(TextInput) ?? [];
    expect(inputs.length).toBe(6);

    // Initial state: all inputs empty
    inputs.forEach((input) => {
      expect((input.props as any).value).toBe('');
    });

    // Simulate pasting "847291" into the first block
    act(() => {
      (inputs[0].props as any).onChangeText('847291');
    });

    // Verify all 6 blocks now contain 1 digit each
    const updatedInputs = renderer?.root.findAllByType(TextInput) ?? [];
    expect((updatedInputs[0].props as any).value).toBe('8');
    expect((updatedInputs[1].props as any).value).toBe('4');
    expect((updatedInputs[2].props as any).value).toBe('7');
    expect((updatedInputs[3].props as any).value).toBe('2');
    expect((updatedInputs[4].props as any).value).toBe('9');
    expect((updatedInputs[5].props as any).value).toBe('1');
  });

  it('handles formatted pasted OTP (e.g., "123-456") cleanly across blocks', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <OtpVerificationScreen route={{ params: { phoneNumber: '+919999999999' } }} />
      );
    });

    const inputs = renderer?.root.findAllByType(TextInput) ?? [];
    // Paste formatted code with dash or spaces
    act(() => {
      (inputs[0].props as any).onChangeText('582-194');
    });

    const updatedInputs = renderer?.root.findAllByType(TextInput) ?? [];
    expect((updatedInputs[0].props as any).value).toBe('5');
    expect((updatedInputs[1].props as any).value).toBe('8');
    expect((updatedInputs[2].props as any).value).toBe('2');
    expect((updatedInputs[3].props as any).value).toBe('1');
    expect((updatedInputs[4].props as any).value).toBe('9');
    expect((updatedInputs[5].props as any).value).toBe('4');
  });

  it('renders verify button with fullWidth and enables it once 6 digits are filled', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <OtpVerificationScreen route={{ params: { phoneNumber: '+919999999999' } }} />
      );
    });

    const button = renderer?.root.findByType(Button);
    expect(button).toBeDefined();
    expect((button?.props as any).fullWidth).toBe(true);
    expect((button?.props as any).disabled).toBe(true);

    // Paste 6-digit OTP
    const inputs = renderer?.root.findAllByType(TextInput) ?? [];
    act(() => {
      (inputs[0].props as any).onChangeText('123456');
    });

    const updatedButton = renderer?.root.findByType(Button);
    expect((updatedButton?.props as any).disabled).toBe(false);
  });
});
