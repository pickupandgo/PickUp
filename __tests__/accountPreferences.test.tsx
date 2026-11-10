import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Linking, Alert, Text } from 'react-native';
import { SettingsScreen } from '../src/screens/account/SettingsScreen';
import { SettingsRow } from '../src/components/molecules/SettingsRow';
import { SupportContactPanel } from '../src/components/account/SupportContactPanel';
import { PrivacyScreen } from '../src/screens/account/PrivacyScreen';
import { AccountRestrictedScreen } from '../src/screens/account/AccountRestrictedScreen';
import { SubscriptionScreen } from '../src/screens/account/SubscriptionScreen';
import { SubscriptionProcessingScreen } from '../src/screens/account/SubscriptionProcessingScreen';
import { SubscriptionResultScreen } from '../src/screens/account/SubscriptionResultScreen';
import { SubscriptionService } from '../src/services/subscription/SubscriptionService';
import { openSupportContact } from '../src/services/supportContact';
import { SUPPORT_EMAIL, SUPPORT_PHONE_LABEL } from '../src/config/support';
jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/i18n', () => ({
  useI18n: () => ({ locale: 'hi', t: (key: string) => key }),
}));
const mockRefresh = jest.fn();
jest.mock('../src/hooks/useDriverOnboarding', () => ({
  useDriverOnboarding: () => ({
    summary: { approvalStatus: 'SUSPENDED' },
    loading: false,
    error: null,
    refresh: mockRefresh,
  }),
}));
const nav = () => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  popToTop: jest.fn(),
});
const mount = async (element: React.ReactElement) => {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(element);
  });
  return view;
};
const text = (view: Renderer.ReactTestRenderer) =>
  view.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
afterEach(() => {
  jest.restoreAllMocks();
});
test('Settings has unique working destinations and the actual selected language', async () => {
  const navigation = nav();
  const view = await mount(<SettingsScreen navigation={navigation as never} />);
  const rows = view.root.findAllByType(SettingsRow);
  expect(rows).toHaveLength(4);
  expect(rows[0].props.value).toBe('Hindi');
  await act(async () => {
    for (const row of rows) row.props.onPress();
  });
  expect(navigation.navigate.mock.calls).toEqual([
    ['LanguageSelection'],
    ['Notifications'],
    ['Support'],
    ['Privacy'],
  ]);
  expect(text(view)).not.toContain('Subscriptions');
  expect(text(view)).not.toContain('Logout');
  await act(async () => view.unmount());
});
test('support opens the dialer/mail composer only on a tap and exposes a failure fallback', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const alert = jest.spyOn(Alert, 'alert');
  const view = await mount(<SupportContactPanel />);
  expect(open).not.toHaveBeenCalled();
  for (const label of ['Call support', 'Email support'])
    await act(async () =>
      view.root
        .findAll(node => node.props.accessibilityLabel === label)[0]
        .props.onPress(),
    );
  expect(open.mock.calls[0][0]).toMatch(/^tel:\+91/);
  expect(open.mock.calls[1][0]).toContain(`mailto:${SUPPORT_EMAIL}`);
  open.mockRejectedValueOnce(new Error('no dialer'));
  await openSupportContact('call');
  expect(alert).toHaveBeenCalledWith(
    'Could not open contact app',
    expect.stringContaining(SUPPORT_PHONE_LABEL),
  );
  await act(async () => view.unmount());
});
test('Privacy opens OS settings and does not invent a published policy or completed deletion', async () => {
  const settings = jest
    .spyOn(Linking, 'openSettings')
    .mockResolvedValue(undefined);
  const view = await mount(
    <PrivacyScreen navigation={nav() as never} route={{} as never} />,
  );
  expect(text(view)).toContain('has not been configured');
  expect(text(view)).toContain('deletion is not connected');
  await act(async () => view.root.findByType(SettingsRow).props.onPress());
  expect(settings).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});
test('account review uses actual status and connects support/privacy/refresh without a fabricated reason', async () => {
  const navigation = nav();
  const view = await mount(
    <AccountRestrictedScreen navigation={navigation as never} />,
  );
  expect(text(view)).toContain('SUSPENDED');
  const press = (label: string) =>
    view.root.findAll(
      node =>
        typeof node.props.onPress === 'function' &&
        node.findAllByType(Text).some(child => child.props.children === label),
    )[0];
  await act(async () => {
    press('Contact support').props.onPress();
    press('Privacy & permissions').props.onPress();
    press('Refresh status').props.onPress();
  });
  expect(navigation.navigate.mock.calls).toEqual([['Support'], ['Privacy']]);
  expect(mockRefresh).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});
test.each([
  SubscriptionScreen,
  SubscriptionProcessingScreen,
  SubscriptionResultScreen,
])(
  'even a legacy success route cannot activate or pretend to process a plan',
  async Screen => {
    jest.useFakeTimers();
    const navigation = nav();
    const view = await mount(
      React.createElement(Screen as React.ComponentType<any>, {
        navigation,
        route: { params: { success: true } },
      }),
    );
    await act(async () => jest.advanceTimersByTime(10_000));
    expect(text(view)).toContain('Subscriptions are not available');
    expect(text(view)).not.toContain('Subscription Activated');
    expect(navigation.navigate).not.toHaveBeenCalled();
    await act(async () => view.unmount());
    jest.useRealTimers();
  },
);
test('legacy service calls fail explicitly instead of granting demo plans or posting unsupported payments', async () => {
  const service = SubscriptionService.getInstance();
  await expect(service.getPlans()).rejects.toMatchObject({
    code: 'SUBSCRIPTIONS_UNAVAILABLE',
  });
  await expect(service.getCurrent()).rejects.toMatchObject({
    code: 'SUBSCRIPTIONS_UNAVAILABLE',
  });
  await expect(
    service.purchase('fake-plan', 'fake-method'),
  ).rejects.toMatchObject({ code: 'SUBSCRIPTIONS_UNAVAILABLE' });
});
