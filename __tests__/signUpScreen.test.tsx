import React from 'react';
import { Image, TextInput, Text } from 'react-native';
import TestRenderer, { act, ReactTestRenderer } from 'react-test-renderer';
import { SignUpScreen } from '../src/screens/auth/SignUpScreen';
import Button from '../src/components/atoms/Button';
import * as authService from '../src/auth/authService';

// Mock authService
jest.mock('../src/auth/authService', () => ({
  sendPhoneOTP: jest.fn().mockResolvedValue('mock-verification-id'),
  signInWithGoogle: jest.fn().mockResolvedValue({ user: { uid: 'google-user-123' } }),
  formatToE164: jest.fn((p: string) => `+91${p}`),
  mapFirebaseAuthError: jest.fn((e: any) => e?.message || 'Authentication error'),
  getRemainingCooldown: jest.fn(() => 0),
  hasActiveSession: jest.fn(() => false),
  usePhoneCooldown: jest.fn(() => ({ cooldownRemaining: 0, isCoolingDown: false })),
}));

// Mock icons
jest.mock('react-native-vector-icons/Feather', () => 'Feather');

describe('SignUpScreen UI Modifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders official MultipleRide logo with resizeMode="contain" and removes box emoji', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<SignUpScreen />);
    });

    const images = renderer?.root.findAllByType(Image);
    expect(images?.length).toBeGreaterThanOrEqual(1);

    const logo = images?.find(
      (img) => (img.props as any).accessibilityLabel === 'MultipleRide App Logo'
    );
    expect(logo).toBeDefined();
    expect((logo?.props as any).resizeMode).toBe('contain');

    // Confirm box illustration 📦 is NOT rendered
    const allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    const hasBox = allTexts.some((txt) => typeof txt === 'string' && txt.includes('📦'));
    expect(hasBox).toBe(false);
  });

  it('removes top Log In / Sign Up segmented switcher while preserving bottom Log In link', () => {
    const mockNavigate = jest.fn();
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<SignUpScreen navigation={{ navigate: mockNavigate }} />);
    });

    const allTextNodes = renderer?.root.findAllByType(Text);
    const stringTexts = allTextNodes?.map((t) =>
      Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')
    );

    // Title is "Create Account", subtitle is "Sign up to start booking rides and package deliveries"
    expect(stringTexts?.some((txt) => txt === 'Create Account')).toBe(true);
    expect(
      stringTexts?.some((txt) => txt === 'Sign up to start booking rides and package deliveries')
    ).toBe(true);

    // Top segmented control is gone: there should NOT be a button/tab titled "Log In" at the top
    // The only "Log In" text is in the bottom switchRow: "Already have an account? Log In"
    const logInLinks = allTextNodes?.filter((t) => t.props.children === 'Log In') || [];
    expect(logInLinks.length).toBe(1);

    // Clicking bottom Log In link navigates to LoginScreen
    act(() => {
      (logInLinks[0]?.props as any).onPress?.();
    });
    expect(mockNavigate).toHaveBeenCalledWith('LoginScreen');
  });

  it('removes visible Mobile OTP selector button while preserving Mobile Number input and Get OTP flow', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<SignUpScreen />);
    });

    const allTextNodes = renderer?.root.findAllByType(Text);
    const stringTexts = allTextNodes?.map((t) =>
      Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')
    );

    // Mobile OTP selector tab is completely removed from the visible UI
    expect(stringTexts?.some((txt) => txt === 'Mobile OTP')).toBe(false);

    // Mobile Number field label and inputs remain intact
    expect(stringTexts?.some((txt) => txt.includes('MOBILE NUMBER'))).toBe(true);

    // Email & Password tab/inputs are completely absent
    expect(stringTexts?.some((txt) => txt.includes('Email & Password'))).toBe(false);
    expect(stringTexts?.some((txt) => txt.includes('EMAIL ADDRESS'))).toBe(false);
    expect(stringTexts?.some((txt) => txt.includes('PASSWORD'))).toBe(false);
    expect(stringTexts?.some((txt) => txt.includes('CONFIRM PASSWORD'))).toBe(false);
    expect(stringTexts?.some((txt) => txt.includes('Sign Up with Email'))).toBe(false);
  });

  it('removes Continue with Apple button and keeps Continue with Google button only', async () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<SignUpScreen />);
    });

    // Verify Apple sign in text and label do not exist
    const allTexts = renderer?.root.findAllByType(Text).map((t) => t.props.children) || [];
    expect(allTexts?.some((txt) => typeof txt === 'string' && txt.includes('Apple'))).toBe(false);

    // Google button must exist
    const googleButton = (renderer?.root as any)?.find(
      (el: any) =>
        el.props.accessibilityLabel === 'Continue with Google' ||
        (el.props.onPress &&
          el.findAllByType &&
          el.findAllByType(Text).some((t: any) => t.props.children === 'Continue with Google'))
    );
    expect(googleButton).toBeDefined();

    // Trigger Google sign in
    await act(async () => {
      (googleButton?.props as any)?.onPress?.();
    });
    expect(authService.signInWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('preserves mobile number validation and Get OTP workflow with authMode signup', async () => {
    const mockNavigate = jest.fn();
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(
        <SignUpScreen navigation={{ navigate: mockNavigate }} />
      );
    });

    const textInput = renderer?.root.findByType(TextInput);
    expect(textInput).toBeDefined();
    if (!textInput) throw new Error('TextInput not found');
    expect((textInput.props as any).keyboardType).toBe('phone-pad');
    expect((textInput.props as any).placeholder).toBe('Enter 10-digit number');

    // Type 10-digit valid number
    await act(async () => {
      (textInput.props as any).onChangeText('9876543210');
    });

    // Find Get OTP button
    const getOtpBtn = renderer?.root.findByType(Button);
    expect(getOtpBtn).toBeDefined();
    expect((getOtpBtn?.props as any).label).toBe('Get OTP');
    expect((getOtpBtn?.props as any).disabled).toBe(false);

    // Press Get OTP
    await act(async () => {
      (getOtpBtn?.props as any).onPress();
    });

    expect(authService.sendPhoneOTP).toHaveBeenCalledWith('+919876543210');
    expect(mockNavigate).toHaveBeenCalledWith('OtpVerificationScreen', {
      phoneNumber: '+919876543210',
      authMode: 'signup',
    });
  });

  it('renders Terms of Service and Privacy Policy text', () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(<SignUpScreen />);
    });

    const allTextNodes = renderer?.root.findAllByType(Text);
    const stringTexts = allTextNodes?.map((t) =>
      Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children || '')
    );

    expect(
      stringTexts?.some((txt) => txt.includes('By signing up, you agree to our'))
    ).toBe(true);
    expect(stringTexts?.some((txt) => txt.includes('Terms of Service'))).toBe(true);
    expect(stringTexts?.some((txt) => txt.includes('Privacy Policy'))).toBe(true);
  });
});
