import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { SessionProvider, useSession } from '../src/state/SessionContext';
import * as sessionModule from '../src/state/session';
import * as userProfileApi from '../src/api/userProfile';
import * as authService from '../src/auth/authService';

let authStateCallback: ((user: any) => Promise<void>) | null = null;

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({
    currentUser: { uid: 'test-user-456', phoneNumber: '+919876543210' },
  }),
  onAuthStateChanged: jest.fn((_auth, cb) => {
    authStateCallback = cb;
    return jest.fn(); // unsubscribe
  }),
}));

jest.mock('../src/config/env', () => ({
  env: {
    apiBaseUrl: 'https://engine.test',
    paymentsApiBaseUrl: 'https://pay.test',
  },
  hasPaymentsConfig: () => false,
}));

jest.mock('../src/api/payments', () => ({
  registerCustomer: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/auth/authService', () => ({
  signOut: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/api/userProfile', () => ({
  fetchUserProfileApi: jest.fn(),
  saveUserProfileApi: jest.fn(),
}));

jest.mock('../src/state/session', () => ({
  isProfileComplete: jest.fn(),
  setProfileComplete: jest.fn().mockResolvedValue(undefined),
  getCustomerProfile: jest.fn(),
  clearSession: jest.fn().mockResolvedValue(undefined),
  setLoggedIn: jest.fn().mockResolvedValue(undefined),
}));

const TestConsumer: React.FC = () => {
  const { isLoggedIn, hasProfile, userProfile } = useSession();
  return (
    <>
      <Text testID="isLoggedIn">{String(isLoggedIn)}</Text>
      <Text testID="hasProfile">{String(hasProfile)}</Text>
      <Text testID="userName">{userProfile?.fullName || 'none'}</Text>
    </>
  );
};

describe('SessionContext — App Reopen Without Registration Form Flash', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('1. immediately resolves hasProfile: true when local profile exists upon reopening app', async () => {
    (sessionModule.getCustomerProfile as jest.Mock).mockResolvedValue({
      fullName: 'Rajesh Sharma',
      email: 'rajesh@example.com',
      phone: '+919876543210',
    });
    (sessionModule.isProfileComplete as jest.Mock).mockResolvedValue(true);
    (userProfileApi.fetchUserProfileApi as jest.Mock).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(null), 100))
    );

    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(
        <SessionProvider>
          <TestConsumer />
        </SessionProvider>
      );
    });

    // Trigger Firebase auth state restoration
    await act(async () => {
      if (authStateCallback) {
        await authStateCallback({ uid: 'test-user-456', phoneNumber: '+919876543210' });
      }
    });

    const root = renderer.root;
    const isLoggedInNode = root.findByProps({ testID: 'isLoggedIn' });
    const hasProfileNode = root.findByProps({ testID: 'hasProfile' });
    const userNameNode = root.findByProps({ testID: 'userName' });

    // Both must be true IMMEDIATELY without waiting for remote fetch or showing onboarding form
    expect(isLoggedInNode.props.children).toBe('true');
    expect(hasProfileNode.props.children).toBe('true');
    expect(userNameNode.props.children).toBe('Rajesh Sharma');
  });

  it('2. sets hasProfile: false for truly new user with no local or remote profile', async () => {
    (sessionModule.getCustomerProfile as jest.Mock).mockResolvedValue(null);
    (sessionModule.isProfileComplete as jest.Mock).mockResolvedValue(false);
    (userProfileApi.fetchUserProfileApi as jest.Mock).mockResolvedValue(null);

    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(
        <SessionProvider>
          <TestConsumer />
        </SessionProvider>
      );
    });

    await act(async () => {
      if (authStateCallback) {
        await authStateCallback({ uid: 'new-user-789', phoneNumber: '+919999999999' });
      }
    });

    const root = renderer.root;
    const isLoggedInNode = root.findByProps({ testID: 'isLoggedIn' });
    const hasProfileNode = root.findByProps({ testID: 'hasProfile' });

    expect(isLoggedInNode.props.children).toBe('true');
    expect(hasProfileNode.props.children).toBe('false');
  });

  it('3. updates profile and retains hasProfile: true when markProfileDone is called', async () => {
    (sessionModule.getCustomerProfile as jest.Mock).mockResolvedValue(null);
    (sessionModule.isProfileComplete as jest.Mock).mockResolvedValue(false);
    (userProfileApi.saveUserProfileApi as jest.Mock).mockResolvedValue({
      fullName: 'Anita Roy',
      email: 'anita@example.com',
    });

    let contextRef: any;
    const ActionConsumer: React.FC = () => {
      const session = useSession();
      contextRef = session;
      return <Text testID="status">{String(session.hasProfile)}</Text>;
    };

    let renderer: any;
    await act(async () => {
      renderer = TestRenderer.create(
        <SessionProvider>
          <ActionConsumer />
        </SessionProvider>
      );
    });

    await act(async () => {
      await contextRef.markProfileDone({
        fullName: 'Anita Roy',
        email: 'anita@example.com',
      });
    });

    const statusNode = renderer.root.findByProps({ testID: 'status' });
    expect(statusNode.props.children).toBe('true');
    expect(contextRef.userProfile?.fullName).toBe('Anita Roy');
    expect(sessionModule.setProfileComplete).toHaveBeenCalled();
  });
});
