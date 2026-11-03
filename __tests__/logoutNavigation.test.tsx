import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { RootNavigator } from '../src/navigation/RootNavigator';

let mockUser: { uid: string } | null = null;
let mockObserve: (user: typeof mockUser) => Promise<void>;
const mockBootstrap = jest.fn(); const mockOnboarding = jest.fn();
const mockUnsubscribe = jest.fn();
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../src/services/auth/AuthService', () => ({ AuthService: { getInstance: () => ({
  observeAuthState: (callback: typeof mockObserve) => { mockObserve = callback; return mockUnsubscribe; },
  bootstrapDriver: mockBootstrap, getOnboarding: mockOnboarding,
}) } }));
jest.mock('../src/navigation/stacks/AuthStack', () => ({ AuthStack: () => null }));
jest.mock('../src/navigation/MainTabNavigator', () => ({ MainTabNavigator: () => null }));
jest.mock('../src/screens/onboarding/DriverOnboardingFlow', () => ({ DriverOnboardingScreen: () => null }));
jest.mock('../src/screens/notifications/NotificationsScreen', () => ({ NotificationsScreen: () => null }));
jest.mock('@react-navigation/native-stack', () => {
  const ReactModule = require('react');
  const Screen = () => null;
  const Navigator = ({ children }: { children: React.ReactNode }) => ReactModule.createElement(ReactModule.Fragment, null, children);
  return { createNativeStackNavigator: () => ({ Navigator, Screen }) };
});
let view: Renderer.ReactTestRenderer;
const routes = () => view.root.findAll(node => typeof node.props.name === 'string').map(node => node.props.name);
const mount = async () => { await act(() => { view = Renderer.create(<RootNavigator />); }); };
const authenticate = async () => { mockUser = { uid: 'partner' }; await act(async () => { await mockObserve(mockUser); }); };
beforeEach(() => { jest.clearAllMocks(); mockUser = null; mockBootstrap.mockResolvedValue({ approvalStatus: 'APPROVED' }); mockOnboarding.mockResolvedValue({ eligible: true }); });
afterEach(async () => { if (view) await act(() => view.unmount()); });

test('signed-out startup registers only login/sign-up, without partner routes', async () => {
  await mount(); await act(async () => { await mockObserve(null); });
  expect(routes()).toEqual(['Auth']); expect(mockBootstrap).not.toHaveBeenCalled();
});
test('logout replaces the complete partner stack with Auth, removing back access to Main/Notifications', async () => {
  await mount(); await authenticate(); expect(routes()).toEqual(['Main', 'Notifications']);
  mockUser = null; await act(async () => { await mockObserve(null); });
  expect(routes()).toEqual(['Auth']);
});
test('signing in again restores the authorized partner stack', async () => {
  await mount(); await act(async () => { await mockObserve(null); });
  await authenticate(); expect(routes()).toEqual(['Main', 'Notifications']);
});
test('bootstrap finishing after logout cannot restore the old account', async () => {
  let resolve: (value: unknown) => void = () => {};
  mockBootstrap.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount(); mockUser = { uid: 'partner' };
  let pending: Promise<void> = Promise.resolve(); await act(() => { pending = mockObserve(mockUser); });
  mockUser = null; await act(async () => { await mockObserve(null); });
  await act(async () => { resolve({ approvalStatus: 'APPROVED' }); await pending; });
  expect(routes()).toEqual(['Auth']); expect(mockOnboarding).not.toHaveBeenCalled();
});
test('delayed old Firebase callback after logout is ignored', async () => {
  await mount(); await act(async () => { await mockObserve(null); await mockObserve({ uid: 'previous-user' }); });
  expect(routes()).toEqual(['Auth']); expect(mockBootstrap).not.toHaveBeenCalled();
});
test('unapproved accounts retain existing onboarding gate', async () => {
  mockOnboarding.mockResolvedValue({ eligible: false });
  await mount(); await authenticate(); expect(routes()).toEqual([]);
});
