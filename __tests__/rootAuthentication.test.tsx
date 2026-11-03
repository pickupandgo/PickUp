import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import type { User } from '@react-native-firebase/auth';
import {
  AuthService,
  type DriverAccount,
} from '../src/services/auth/AuthService';
import { RootNavigator } from '../src/navigation/RootNavigator';

const mockFirebase: { currentUser: User | null } = { currentUser: null };
let mockListener: (user: User | null) => void | Promise<void>;
const mockUnsubscribe = jest.fn();
const mockService = {
  bootstrapDriver: jest.fn(),
  getOnboarding: jest.fn(),
  logout: jest.fn(),
  observeAuthState: jest.fn(listener => {
    mockListener = listener;
    return mockUnsubscribe;
  }),
};
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => mockFirebase,
}));
jest.mock('../src/services/auth/AuthService', () => ({
  AuthService: { getInstance: jest.fn(() => mockService) },
}));
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: ({ name }: { name: string }) => {
      const mockReact = require('react');
      const { Text } = require('react-native');
      return mockReact.createElement(Text, { testID: `route-${name}` }, name);
    },
  }),
}));
jest.mock('../src/navigation/stacks/AuthStack', () => ({
  AuthStack: () => null,
}));
jest.mock('../src/navigation/MainTabNavigator', () => ({
  MainTabNavigator: () => null,
}));
jest.mock('../src/screens/notifications/NotificationsScreen', () => ({
  NotificationsScreen: () => null,
}));
jest.mock('../src/screens/onboarding/DriverOnboardingFlow', () => ({
  DriverOnboardingScreen: (props: object) => {
    const mockReact = require('react');
    const { View } = require('react-native');
    return mockReact.createElement(View, { ...props, testID: 'onboarding' });
  },
}));

describe('UAT root authentication and authoritative account gate', () => {
  let renderer: Renderer.ReactTestRenderer;
  const account = {
    driverId: 'fixture-driver',
    approvalStatus: 'APPROVED',
  } as DriverAccount;
  const user = { uid: 'fixture-firebase-driver' } as User;
  const route = (name: string) =>
    renderer.root
      .findAllByProps({ testID: `route-${name}` })
      .filter(node => typeof node.type === 'string');
  const onboarding = () =>
    renderer.root
      .findAllByProps({ testID: 'onboarding' })
      .filter(node => typeof node.type === 'string');
  const emit = async (identity: User | null) => {
    await act(async () => {
      mockFirebase.currentUser = identity;
      await mockListener(identity);
    });
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    mockFirebase.currentUser = null;
    mockService.bootstrapDriver.mockReset().mockResolvedValue(account);
    mockService.getOnboarding
      .mockReset()
      .mockResolvedValue({ approvalStatus: 'APPROVED', eligible: true });
    jest
      .mocked(AuthService.getInstance)
      .mockReturnValue(
        mockService as unknown as ReturnType<typeof AuthService.getInstance>,
      );
    await act(async () => {
      renderer = Renderer.create(<RootNavigator />);
    });
  });
  afterEach(async () => {
    await act(async () => renderer.unmount());
  });

  it('registers no protected routes while Firebase state is unresolved or unauthenticated', async () => {
    expect(route('Main')).toHaveLength(0);
    expect(route('Notifications')).toHaveLength(0);
    expect(route('TripChat')).toHaveLength(0);
    await emit(null);
    expect(route('Auth')).toHaveLength(1);
    expect(route('Main')).toHaveLength(0);
    expect(route('Notifications')).toHaveLength(0);
    expect(mockService.bootstrapDriver).not.toHaveBeenCalled();
  });
  it('opens Main and Notifications only after both backend account and eligibility succeed', async () => {
    await emit(user);
    expect(mockService.bootstrapDriver).toHaveBeenCalledTimes(1);
    expect(mockService.getOnboarding).toHaveBeenCalledTimes(1);
    expect(route('Main')).toHaveLength(1);
    expect(route('Notifications')).toHaveLength(1);
    expect(route('TripChat')).toHaveLength(1);
    expect(route('Auth')).toHaveLength(0);
  });
  it.each([
    ['PENDING', false],
    ['APPROVED', false],
    ['SUSPENDED', false],
    ['PENDING', true],
    ['APPROVED', 'true'],
  ])(
    'keeps account %s / eligible %s in backend-authoritative onboarding',
    async (approvalStatus, eligible) => {
      mockService.bootstrapDriver.mockResolvedValue({
        ...account,
        approvalStatus,
      });
      mockService.getOnboarding.mockResolvedValue({ approvalStatus, eligible });
      await emit(user);
      expect(onboarding()).toHaveLength(1);
      expect(route('Main')).toHaveLength(0);
      expect(route('Notifications')).toHaveLength(0);
      expect(route('TripChat')).toHaveLength(0);
    },
  );
  it.each(['bootstrapDriver', 'getOnboarding'] as const)(
    'fails closed if %s fails',
    async method => {
      mockService[method].mockRejectedValue(
        new Error('Synthetic service unavailable'),
      );
      await emit(user);
      expect(route('Main')).toHaveLength(0);
      expect(route('Notifications')).toHaveLength(0);
      expect(route('TripChat')).toHaveLength(0);
      expect(
        renderer.root.findAllByProps({
          children: 'We could not verify your account',
        }),
      ).not.toHaveLength(0);
    },
  );
  it('removes protected routes immediately when Firebase signs out', async () => {
    await emit(user);
    await emit(null);
    expect(route('Main')).toHaveLength(0);
    expect(route('Notifications')).toHaveLength(0);
    expect(route('Auth')).toHaveLength(1);
  });
  it('cannot restore protected routes from bootstrap work completed after signout', async () => {
    let complete!: (value: DriverAccount) => void;
    mockService.bootstrapDriver.mockReturnValue(
      new Promise(resolve => {
        complete = resolve;
      }),
    );
    await act(async () => {
      mockFirebase.currentUser = user;
      void mockListener(user);
    });
    await emit(null);
    await act(async () => {
      complete(account);
    });
    expect(mockService.getOnboarding).not.toHaveBeenCalled();
    expect(route('Auth')).toHaveLength(1);
    expect(route('Main')).toHaveLength(0);
  });
  it('ignores an old identity callback delivered after Firebase has signed out', async () => {
    await emit(null);
    await act(async () => {
      await mockListener(user);
    });
    expect(mockService.bootstrapDriver).not.toHaveBeenCalled();
    expect(route('Auth')).toHaveLength(1);
  });
  it('keeps the newer account when an older bootstrap resolves late', async () => {
    let complete!: (value: DriverAccount) => void;
    mockService.bootstrapDriver.mockReturnValueOnce(
      new Promise(resolve => {
        complete = resolve;
      }),
    );
    await act(async () => {
      mockFirebase.currentUser = user;
      void mockListener(user);
    });
    await emit({ uid: 'second-fixture-identity' } as User);
    await act(async () => {
      complete({ ...account, approvalStatus: 'PENDING' });
    });
    expect(route('Main')).toHaveLength(1);
    expect(onboarding()).toHaveLength(0);
    expect(mockService.getOnboarding).toHaveBeenCalledTimes(1);
  });
  it('does not treat a missing auth observer as a mock authenticated session', async () => {
    await act(async () => renderer.unmount());
    jest.mocked(AuthService.getInstance).mockReturnValue({
      ...mockService,
      observeAuthState: undefined,
    } as unknown as ReturnType<typeof AuthService.getInstance>);
    await act(async () => {
      renderer = Renderer.create(<RootNavigator />);
    });
    expect(route('Main')).toHaveLength(0);
    expect(route('Notifications')).toHaveLength(0);
  });
});
