import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput, Pressable, Text } from 'react-native';
import CreateProfileScreen from '../src/screens/profile/CreateProfileScreen';
import * as paymentsApi from '../src/api/payments';
import * as envConfig from '../src/config/env';
import * as authModule from '@react-native-firebase/auth';
import Button from '../src/components/atoms/Button';
import { ApiError } from '../src/api/http';

const mockLogin = jest.fn();
const mockMarkProfileDone = jest.fn();
const mockLogout = jest.fn();

jest.mock('../src/state/SessionContext', () => ({
  useSession: () => ({
    login: mockLogin,
    markProfileDone: mockMarkProfileDone,
    logout: mockLogout,
    isLoggedIn: false,
    hasProfile: false,
  }),
}));

jest.mock('../src/config/env', () => ({
  env: {
    paymentsApiBaseUrl: 'https://backend.test',
  },
  hasPaymentsConfig: jest.fn(() => true),
}));

jest.mock('../src/api/payments', () => ({
  registerCustomer: jest.fn(),
}));

describe('CreateProfileScreen — Form Validation, Firebase Phone Display & Provisioning', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      currentUser: { phoneNumber: '+919876543210', uid: 'test-user-uid' } as any,
    } as any);
  });

  const getSaveButton = (root: any): any => {
    return root.findByType(Button);
  };

  const getInputs = (root: any): any => {
    const inputs = root.findAllByType(TextInput);
    return {
      fullNameInput: inputs.find((i: any) => i.props.placeholder === 'Enter your full name')!,
      emailInput: inputs.find((i: any) => i.props.placeholder === 'Enter your email address')!,
      ageInput: inputs.find((i: any) => i.props.placeholder === 'Enter your age'),
      addressInput: inputs.find((i: any) => i.props.placeholder === 'Enter your address'),
    };
  };

  it('1. displays the actual verified Firebase phone number and checkmark icon', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    // Check that +919876543210 is rendered
    const textNodes = root.findAllByType(Text);
    const phoneNode = textNodes.find((t) => t.props.children === '+919876543210');
    expect(phoneNode).toBeDefined();

    // Check that Feather icon "check-circle" is displayed for verified phone
    const icons = (root as any).findAll((node: any) => node.type === 'Feather');
    const checkCircleIcon = icons.find((icon: any) => icon.props.name === 'check-circle');
    expect(checkCircleIcon).toBeDefined();
  });

  it('2. initially disables the SAVE & CONTINUE button when required fields are empty', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const saveButton = getSaveButton(root);
    expect(saveButton.props.disabled).toBe(true);
  });

  it('3. keeps button disabled if only Full Name is entered (email is missing)', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput } = getInputs(root);

    await act(async () => {
      fullNameInput.props.onChangeText('Rajesh Kumar');
    });

    const saveButton = getSaveButton(root);
    expect(saveButton.props.disabled).toBe(true);
  });

  it('4. keeps button disabled if email format is invalid', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput } = getInputs(root);

    await act(async () => {
      fullNameInput.props.onChangeText('Rajesh Kumar');
      emailInput.props.onChangeText('invalid-email-format');
    });

    const saveButton = getSaveButton(root);
    expect(saveButton.props.disabled).toBe(true);
  });

  it('5. enables the button only when both Full Name and Email Address are valid', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput } = getInputs(root);

    await act(async () => {
      fullNameInput.props.onChangeText('Rajesh Kumar');
      emailInput.props.onChangeText('rajesh@example.com');
    });

    const saveButton = getSaveButton(root);
    expect(saveButton.props.disabled).toBe(false);
  });

  it('6. disables the button again if user clears the name or enters invalid email', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput } = getInputs(root);

    await act(async () => {
      fullNameInput.props.onChangeText('Rajesh Kumar');
      emailInput.props.onChangeText('rajesh@example.com');
    });
    expect(getSaveButton(root).props.disabled).toBe(false);

    // Clear name
    await act(async () => {
      fullNameInput.props.onChangeText('   ');
    });
    expect(getSaveButton(root).props.disabled).toBe(true);

    // Restore name, make email invalid
    await act(async () => {
      fullNameInput.props.onChangeText('Rajesh Kumar');
      emailInput.props.onChangeText('rajesh@');
    });
    expect(getSaveButton(root).props.disabled).toBe(true);
  });

  it('7. displays inline validation messages on blur when required fields are missing or invalid', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput } = getInputs(root);

    // Trigger blur on empty name
    await act(async () => {
      fullNameInput.props.onBlur();
    });

    let textNodes = root.findAllByType(Text);
    expect(textNodes.some((t) => t.props.children === 'Full name is required.')).toBe(true);

    // Trigger blur on invalid email
    await act(async () => {
      emailInput.props.onChangeText('bademail');
      emailInput.props.onBlur();
    });

    textNodes = root.findAllByType(Text);
    expect(textNodes.some((t) => t.props.children === 'Please enter a valid email address.')).toBe(true);
  });

  it('8. submits trimmed values and proceeds through registration, profile storage, and login on success', async () => {
    const mockRegister = jest.spyOn(paymentsApi, 'registerCustomer').mockResolvedValueOnce({
      customerId: 'cust-123',
      phone: '+919876543210',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      name: 'Rajesh Kumar',
      email: 'rajesh@example.com',
    } as any);

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput, ageInput, addressInput } = getInputs(root);

    await act(async () => {
      fullNameInput.props.onChangeText('   Rajesh Kumar   ');
      emailInput.props.onChangeText('   rajesh@example.com   ');
      ageInput?.props.onChangeText(' 30 ');
      addressInput?.props.onChangeText(' 123 Main St ');
    });

    const saveButton = getSaveButton(root);
    expect(saveButton.props.disabled).toBe(false);

    await act(async () => {
      saveButton.props.onPress();
    });

    expect(mockRegister).toHaveBeenCalledWith({
      name: 'Rajesh Kumar',
      email: 'rajesh@example.com',
    });
    expect(mockMarkProfileDone).toHaveBeenCalledWith({
      fullName: 'Rajesh Kumar',
      email: 'rajesh@example.com',
      age: '30',
      address: '123 Main St',
    });
    expect(mockLogin).toHaveBeenCalled();
  });

  it('9. handles backend registration errors without clearing entered data and blocks navigation', async () => {
    const conflictError = new ApiError(
      'http',
      'Conflict',
      409,
      { error: { code: 'PHONE_ALREADY_REGISTERED', message: 'This mobile number is already registered to another account. Please contact support' } }
    );
    jest.spyOn(paymentsApi, 'registerCustomer').mockRejectedValueOnce(conflictError);

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput } = getInputs(root);

    await act(async () => {
      fullNameInput.props.onChangeText('Rajesh Kumar');
      emailInput.props.onChangeText('rajesh@example.com');
    });

    const saveButton = getSaveButton(root);

    await act(async () => {
      saveButton.props.onPress();
    });

    // Form data must NOT be cleared
    const inputsAfter = getInputs(root);
    expect(inputsAfter.fullNameInput.props.value).toBe('Rajesh Kumar');
    expect(inputsAfter.emailInput.props.value).toBe('rajesh@example.com');

    // Navigation and profile completion must NOT have occurred
    expect(mockMarkProfileDone).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();

    // Error message must be rendered
    const textNodes = root.findAllByType(Text);
    expect(
      textNodes.some((t) =>
        typeof t.props.children === 'string' &&
        t.props.children.includes('This mobile number is already registered to another account')
      )
    ).toBe(true);
  });

  it('10. handles missing phone number gracefully: disables button, hides checkmark, and prompts for OTP login', async () => {
    // Current user has no phone number
    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      currentUser: { phoneNumber: null } as any,
    } as any);

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput } = getInputs(root);

    await act(async () => {
      fullNameInput.props.onChangeText('Rajesh Kumar');
      emailInput.props.onChangeText('rajesh@example.com');
    });

    // Even with valid name and email, button must remain disabled because phone is missing
    const saveButton = getSaveButton(root);
    expect(saveButton.props.disabled).toBe(true);

    // Missing phone warning must be visible
    const textNodes = root.findAllByType(Text);
    expect(
      textNodes.some((t) => t.props.children === 'No verified mobile number')
    ).toBe(true);
    expect(
      textNodes.some((t) =>
        typeof t.props.children === 'string' &&
        t.props.children.includes('A verified mobile number is required to register')
      )
    ).toBe(true);

    // Checkmark icon must NOT be rendered
    const icons = (root as any).findAll((node: any) => node.type === 'Feather');
    const checkCircle = icons.find((icon: any) => icon.props.name === 'check-circle');
    expect(checkCircle).toBeUndefined();
  });

  it('11. tapping Sign Out invokes session logout, resets navigation stack to LoginScreen without submitting profile data', async () => {
    const mockReset = jest.fn();
    const mockNavigate = jest.fn();

    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <CreateProfileScreen navigation={{ reset: mockReset, navigate: mockNavigate }} />
      );
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput } = getInputs(root);

    // Enter draft data
    await act(async () => {
      fullNameInput.props.onChangeText('Unsaved Name');
      emailInput.props.onChangeText('unsaved@example.com');
    });

    // Find Sign Out text and its clickable pressable container
    const signOutTextNode = root
      .findAllByType(Text)
      .find((t) => t.props.children === 'Sign Out');
    expect(signOutTextNode).toBeDefined();

    let clickableParent: any = (signOutTextNode as any)?.parent;
    while (clickableParent && !clickableParent.props.onPress) {
      clickableParent = clickableParent.parent;
    }
    expect(clickableParent).toBeDefined();

    // Tap Sign Out
    await act(async () => {
      clickableParent.props.onPress();
    });

    // Session logout must be invoked
    expect(mockLogout).toHaveBeenCalledTimes(1);

    // Navigation must be reset to LoginScreen (clearing the profile screen from back stack)
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'LoginScreen' }],
    });

    // Profile data must NOT be submitted
    expect(paymentsApi.registerCustomer).not.toHaveBeenCalled();
    expect(mockMarkProfileDone).not.toHaveBeenCalled();
  });

  it('12. tapping Sign In with Mobile OTP link invokes session logout and resets navigation', async () => {
    jest.spyOn(authModule, 'getAuth').mockReturnValue({
      currentUser: { phoneNumber: null } as any,
    } as any);

    const mockReset = jest.fn();
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <CreateProfileScreen navigation={{ reset: mockReset }} />
      );
    });

    const root = renderer!.root;
    const verifyPhoneTextNode = root
      .findAllByType(Text)
      .find((t) => t.props.children === 'Sign In with Mobile OTP');
    expect(verifyPhoneTextNode).toBeDefined();

    let clickableParent: any = (verifyPhoneTextNode as any)?.parent;
    while (clickableParent && !clickableParent.props.onPress) {
      clickableParent = clickableParent.parent;
    }
    expect(clickableParent).toBeDefined();

    await act(async () => {
      clickableParent.props.onPress();
    });

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'LoginScreen' }],
    });
  });

  it('13. address and all text inputs have onFocus listeners wired to scrollToInput', async () => {
    let renderer: ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(<CreateProfileScreen />);
    });

    const root = renderer!.root;
    const { fullNameInput, emailInput, ageInput, addressInput } = getInputs(root);

    expect(typeof addressInput.props.onFocus).toBe('function');
    expect(typeof ageInput.props.onFocus).toBe('function');
    expect(typeof fullNameInput.props.onFocus).toBe('function');
    expect(typeof emailInput.props.onFocus).toBe('function');

    // Triggering onFocus should execute smoothly
    expect(() => {
      act(() => {
        addressInput.props.onFocus();
      });
    }).not.toThrow();
  });
});

