import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import ProfileScreen from '../src/screens/profile/ProfileScreen';
import { SessionProvider, useSession } from '../src/state/SessionContext';
import * as session from '../src/state/session';
import { fetchUserProfileApi } from '../src/api/userProfile';

jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: 'customer-1', phoneNumber: '+919876543210' } }),
  onAuthStateChanged: jest.fn(() => () => {}),
}));
jest.mock('../src/config/env', () => ({ hasPaymentsConfig: () => false }));
jest.mock('../src/api/userProfile', () => ({ fetchUserProfileApi: jest.fn(), saveUserProfileApi: jest.fn() }));
jest.mock('../src/api/payments', () => ({ registerCustomer: jest.fn() }));
jest.mock('../src/state/session', () => ({
  getCustomerProfile: jest.fn(),
  isProfileComplete: jest.fn(),
  setProfileComplete: jest.fn(async () => undefined),
  clearSession: jest.fn(async () => undefined),
}));

const remote = { uid: 'customer-1', fullName: 'Riya', email: 'riya@example.com', phone: '+919876543210' };
const local = { fullName: 'Riya', email: 'riya@example.com', phone: '+919876543210' };

beforeEach(() => {
  jest.clearAllMocks();
  (session.getCustomerProfile as jest.Mock).mockResolvedValue(local);
  (session.isProfileComplete as jest.Mock).mockResolvedValue(true);
});

async function mountProfile() {
  const navigate = jest.fn();
  const addListener = jest.fn((_event, callback) => {
    focus = callback;
    return jest.fn();
  });
  let focus: (() => void) | undefined;
  let refreshProfile: (() => Promise<void>) | undefined;
  const Capture = () => {
    refreshProfile = useSession().refreshProfile;
    return null;
  };
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <SessionProvider>
        <Capture />
        <ProfileScreen navigation={{ addListener, navigate }} />
      </SessionProvider>,
    );
  });
  return { renderer: renderer!, addListener, navigate, getFocus: () => focus, getRefresh: () => refreshProfile };
}

it('does not re-request or rebind focus when a successful profile refresh updates provider state', async () => {
  (fetchUserProfileApi as jest.Mock).mockResolvedValue(remote);
  const { renderer, addListener, getFocus, getRefresh } = await mountProfile();
  const refresh = getRefresh();
  expect(fetchUserProfileApi).toHaveBeenCalledTimes(1);
  expect(addListener).toHaveBeenCalledTimes(1);
  expect(getRefresh()).toBe(refresh);

  await act(async () => { getFocus()?.(); });
  expect(fetchUserProfileApi).toHaveBeenCalledTimes(2);
  expect(addListener).toHaveBeenCalledTimes(1);
  await act(async () => { renderer.unmount(); });
});

it('stops at one request after backend failure and coalesces simultaneous refreshes', async () => {
  (fetchUserProfileApi as jest.Mock).mockRejectedValue(new Error('offline'));
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { renderer, addListener, getRefresh } = await mountProfile();
    expect(fetchUserProfileApi).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(session.getCustomerProfile).not.toHaveBeenCalled();
    expect(renderer.root.findAllByType(Text).some((node) =>
      String(node.props.children).includes('Riya'))).toBe(false);
    const refresh = getRefresh()!;
    await act(async () => { await Promise.all([refresh(), refresh()]); });
    expect(fetchUserProfileApi).toHaveBeenCalledTimes(2);
    await act(async () => { renderer.unmount(); });
  } finally {
    warning.mockRestore();
  }
});

it('has one account hub, unique working shortcuts and no Settings/Account navigation loop', async () => {
  (fetchUserProfileApi as jest.Mock).mockResolvedValue(remote);
  const { renderer, navigate } = await mountProfile();
  const root: any = renderer.root;
  for (const [label, screen] of [['Edit Profile', 'EditProfileScreen'], ['Saved addresses', 'SavedAddressesScreen'], ['Notifications', 'NotificationCenterScreen'], ['Logout', 'LogoutConfirmationScreen']]) {
    const nodes = root.findAll((node: any) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function');
    expect(nodes).toHaveLength(1);
    act(() => nodes[0].props.onPress());
    expect(navigate).toHaveBeenLastCalledWith(screen);
  }
  const text = root.findAllByType(Text).map((node: any) => node.props.children).flat().join(' ');
  expect(text).not.toContain('Settings'); expect(text).not.toContain('Booking History');
  expect(root.findAll((node: any) => node.props.accessibilityLabel === 'Language' && node.props.onPress)).toHaveLength(0);
  await act(async () => renderer.unmount());
});
