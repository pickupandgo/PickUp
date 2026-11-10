import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Image, Linking, Pressable, SectionList, StyleSheet, Text, TextInput } from 'react-native';
import { PartnerAppHeader } from '../src/components/molecules/PartnerAppHeader';
import { PrimaryButton } from '../src/components/atoms/PrimaryButton';
import { AppHeader } from '../src/components/molecules/AppHeader';
import { AccountHeader } from '../src/components/account/AccountLayout';
import { SettingsRow } from '../src/components/molecules/SettingsRow';
import { DocumentNavigationCard } from '../src/components/documents/DocumentNavigationCard';
import { ProfileScreen } from '../src/screens/account/ProfileScreen';
import { SettingsScreen } from '../src/screens/account/SettingsScreen';
import { PrivacyScreen } from '../src/screens/account/PrivacyScreen';
import { LegalInformationScreen } from '../src/screens/account/LegalInformationScreen';
import { DataPermissionsScreen } from '../src/screens/account/DataPermissionsScreen';
import { HelpSupportScreen } from '../src/screens/account/HelpSupportScreen';
import { EditProfileScreen } from '../src/screens/account/EditProfileScreen';
import { legalLinks, approvedHttpsUrl, openApprovedLink } from '../src/config/legal';

jest.mock('react-native', () => Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native')), Pressable: { value: 'Pressable' } }));
jest.mock('../src/components/atoms/Icon', () => 'Icon');
const mockLogout = jest.fn();
jest.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock('../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'hi' }) }));
const profile = { driverId: 'driver', name: 'Actual Partner', phone: '+919000000001', email: 'actual@example.test', address: 'Actual address', photoUrl: 'https://example.test/photo.png', approvalStatus: 'APPROVED' };
const mockState = { profile, loading: false, saving: false, error: null as string | null, refresh: jest.fn(), saveName: jest.fn(async (_name: string) => 'Updated Partner') };
jest.mock('../src/hooks/usePartnerProfile', () => ({ usePartnerProfile: () => mockState }));
let view: Renderer.ReactTestRenderer;
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
const render = async (element: React.ReactElement) => { await act(() => { view = Renderer.create(element); }); };
const text = () => view.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ');
const press = async (label: string) => { await act(async () => { await view.root.findAllByType(Pressable).find(node => node.props.accessibilityLabel === label)!.props.onPress(); }); };
beforeEach(() => { jest.clearAllMocks(); mockState.profile = profile; mockState.loading = false; mockState.saving = false; mockState.error = null; mockState.saveName.mockResolvedValue('Updated Partner'); });
afterEach(async () => { if (view) await act(() => view.unmount()); jest.restoreAllMocks(); });

test('compact shared header has title case, 20sp wrapping title, 48dp actions and working menu/bell', async () => {
  const menu = jest.fn(); const bell = jest.fn(); await render(<PartnerAppHeader onMenu={menu} onNotifications={bell} />);
  expect(text()).toBe('MultipleRide Partner');
  const title = view.root.findByType(Text); expect(StyleSheet.flatten(title.props.style)).toMatchObject({ fontSize: 20, fontWeight: '600', flex: 1 });
  expect(title.props.numberOfLines).toBeUndefined();
  for (const button of view.root.findAllByType(Pressable)) expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 48, height: 48 });
  await press('Open menu'); await press('Notifications'); expect(menu).toHaveBeenCalledTimes(1); expect(bell).toHaveBeenCalledTimes(1);
});
test('Profile displays server name/photo and routes both clear edit entry points without a subscription card', async () => {
  await render(<ProfileScreen navigation={navigation as never} />);
  expect(text()).toContain('Actual Partner'); expect(view.root.findByType(Image).props.source.uri).toBe(profile.photoUrl);
  await press('Edit Profile'); await press('Edit profile photo and details');
  expect(navigation.navigate.mock.calls).toEqual([['EditProfile'], ['EditProfile']]);
  expect(text()).not.toMatch(/Subscription|Pro Plan|MULTIPLERIDE PARTNER/);
  await act(() => view.root.findByType(SettingsRow).props.onPress()); expect(navigation.navigate).toHaveBeenLastCalledWith('Settings');
}, 15000); // Allow the first Profile render to cold-load React Native Image on Windows.
test('Settings retains preferences and privacy once; documents and logout remain on Account', async () => {
  await render(<SettingsScreen navigation={navigation as never} />);
  const rows = view.root.findAllByType(SettingsRow);
  expect(rows.map(row => row.props.label)).toEqual(['Language', 'Floating window', 'Notifications', 'Help & support', 'Privacy & permissions']);
  for (const row of rows) await act(() => row.props.onPress());
  expect(navigation.navigate.mock.calls).toEqual([['LanguageSelection'], ['FloatingWindow'], ['Notifications'], ['Support'], ['Privacy']]);
  expect(text()).not.toMatch(/Subscription|Logout/);
  await act(() => view.root.findByType(AccountHeader).props.onBack()); expect(navigation.goBack).toHaveBeenCalled();
});
test('Privacy category cards open the correct legal, permission and support routes', async () => {
  await render(<PrivacyScreen navigation={navigation as never} route={{} as never} />);
  const cards = view.root.findAllByType(DocumentNavigationCard);
  expect(cards.map(card => card.props.title)).toEqual(['Privacy Policy', 'Terms of Service', 'Data and Permissions', 'Privacy Support']);
  for (const card of cards) await act(() => card.props.onPress());
  expect(navigation.navigate.mock.calls).toEqual([['LegalInformation', { document: 'privacy' }], ['LegalInformation', { document: 'terms' }], ['DataPermissions'], ['HelpSupport', { topic: 'privacy' }]]);
});
test('approved supplied Privacy Policy opens safely, with useful feedback if browser launch fails', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(<LegalInformationScreen navigation={navigation as never} route={{ params: { document: 'privacy' } } as never} />);
  expect(legalLinks.privacy).toBe('https://www.multipleride.com/privacy');
  await press('View Privacy Policy'); expect(open).toHaveBeenCalledWith('https://www.multipleride.com/privacy');
  open.mockRejectedValue(new Error('No handler')); await press('View Privacy Policy'); expect(text()).toContain('Could not open this page');
});
test('missing Terms and support have clear states and never fabricate legal promises or a contact', async () => {
  await render(<LegalInformationScreen navigation={navigation as never} route={{ params: { document: 'terms' } } as never} />);
  expect(text()).toContain('not available'); expect(view.root.findAllByType(PrimaryButton)).toHaveLength(0);
  await act(() => view.unmount()); await render(<HelpSupportScreen navigation={navigation as never} route={{ params: { topic: 'privacy' } } as never} />);
  expect(text()).toContain('Support contact information is not available'); expect(text()).toContain('does not currently provide an account-removal request flow');
  await press('Privacy Policy'); expect(navigation.navigate).toHaveBeenCalledWith('LegalInformation', { document: 'privacy' });
});
test('configured Terms URL opens and unsafe URL schemes/credentials are rejected', async () => {
  const previous = legalLinks.terms; const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  try { legalLinks.terms = 'https://approved.example.test/partner-terms';
    await render(<LegalInformationScreen navigation={navigation as never} route={{ params: { document: 'terms' } } as never} />);
    await press('View Terms of Service'); expect(open).toHaveBeenCalledWith(legalLinks.terms);
    for (const url of ['http://example.test', ['javascript', 'alert(1)'].join(':'), 'file:///private', 'https://user:secret@example.test', 'bad-url']) {
      expect(approvedHttpsUrl(url)).toBeNull(); await expect(openApprovedLink(url)).rejects.toThrow('not available');
    }
  } finally { legalLinks.terms = previous; }
});
test('Data and Permissions opens actual app settings and handles missing settings handler', async () => {
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  await render(<DataPermissionsScreen navigation={navigation as never} route={{} as never} />);
  expect(text()).toContain('Location'); expect(text()).toContain('Camera and document uploads');
  await press('Open Android app settings'); expect(open).toHaveBeenCalledTimes(1);
  open.mockRejectedValue(new Error('Unavailable')); await press('Open Android app settings'); expect(text()).toContain('Could not open app settings');
});
test('editor loads actual values, preserves phone/identity fields, and saves only after confirmation', async () => {
  await render(<EditProfileScreen navigation={navigation as never} route={{} as never} />);
  expect(text()).toContain(profile.phone); expect(text()).toContain(profile.email); expect(text()).toContain(profile.address);
  expect(text()).toContain('Changing your profile photo is not available');
  expect(view.root.findAllByType(TextInput)).toHaveLength(1);
  const input = view.root.findByType(TextInput); expect(input.props.value).toBe(profile.name);
  await act(() => input.props.onChangeText('Updated Partner'));
  let resolve: (name: string) => void = () => {};
  mockState.saveName.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
  let pending: Promise<void>;
  await act(() => { pending = view.root.findAllByType(PrimaryButton).find(button => button.props.label === 'Save Changes')!.props.onPress(); });
  expect(text()).not.toContain('updated successfully');
  await act(async () => { resolve('Updated Partner'); await pending!; });
  expect(mockState.saveName).toHaveBeenCalledWith('Updated Partner'); expect(text()).toContain('Profile updated successfully');
});
test('invalid input stays local; API failure shows no success; saving disables further UI submissions', async () => {
  await render(<EditProfileScreen navigation={navigation as never} route={{} as never} />);
  await act(() => view.root.findByType(TextInput).props.onChangeText('A')); await press('Save Changes');
  expect(text()).toContain('between 2 and 120'); expect(mockState.saveName).not.toHaveBeenCalled();
  await act(() => view.root.findByType(TextInput).props.onChangeText('New Partner'));
  mockState.saveName.mockRejectedValue(new Error('Server refused')); await press('Save Changes');
  expect(text()).toContain('Server refused'); expect(text()).not.toContain('updated successfully');
  mockState.saving = true; await act(() => view.update(<EditProfileScreen navigation={navigation as never} route={{} as never} />));
  expect(view.root.findByType(TextInput).props.editable).toBe(false);
  expect(view.root.findAllByType(PrimaryButton).find(button => button.props.label === 'Save Changes')!.props.loading).toBe(true);
});
test('restricted partner cannot edit name and Back/Cancel preserve navigation', async () => {
  mockState.profile = { ...profile, approvalStatus: 'SUSPENDED' };
  await render(<EditProfileScreen navigation={navigation as never} route={{} as never} />);
  expect(view.root.findByType(TextInput).props.editable).toBe(false); expect(text()).toContain('account is restricted');
  await press('Cancel'); expect(navigation.goBack).toHaveBeenCalled();
});
