import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Alert, FlatList, Image, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { DocumentNavigationCard } from '../src/components/documents/DocumentNavigationCard';
import { colors } from '../src/theme';
import Icon from '../src/components/atoms/Icon';
import { ProfileScreen } from '../src/screens/account/ProfileScreen';
import { PersonalDocumentsScreen } from '../src/screens/account/PersonalDocumentsScreen';
import { DocumentsHubScreen } from '../src/screens/account/DocumentsHubScreen';
import { KYCStatusScreen } from '../src/screens/account/KYCStatusScreen';
import { VehicleDocumentsScreen } from '../src/screens/account/VehicleDocumentsScreen';
import { DocumentPreviewScreen } from '../src/screens/account/DocumentPreviewScreen';
import { DocumentCard } from '../src/components/documents/DocumentCard';
import { useDocumentPage, useDocumentPreview } from '../src/hooks/useDocumentPreview';

jest.setTimeout(30_000);
jest.mock('react-native', () => Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native')), Pressable: { value: 'Pressable' } }));
jest.mock('../src/components/atoms/Icon', () => 'Icon');
const mockLogout = jest.fn(async () => {}); const mockRefresh = jest.fn(async () => {});
jest.mock('../src/hooks/useAuth', () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock('../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: 'en' }) }));
const photo = { id: 'photo', version: 1, documentType: 'DRIVER_PHOTO', status: 'VERIFIED', createdAt: '2026-11-01' };
const licence = { ...photo, id: 'licence', documentType: 'DRIVING_LICENSE', status: 'REJECTED', rejectionReason: 'Photo is blurred' };
const rc = { ...photo, id: 'rc-a', documentType: 'REGISTRATION_CERTIFICATE' };
const aadhaar = { ...photo, id: 'aadhaar', documentType: 'AADHAAR_CARD', status: 'QUARANTINED' };
const insurance = { ...rc, id: 'insurance-a', documentType: 'INSURANCE_CERTIFICATE' };
const mockSummary = { profileName: 'Partner', requiredDocuments: { kyc: ['DRIVER_PHOTO', 'DRIVING_LICENSE', 'IDENTITY_PROOF'], vehicle: [] },
  kyc: { status: 'IN_REVIEW', documents: [photo, licence, aadhaar] },
  vehicles: [{ id: 'a', makeModel: 'Actual model', registrationNumber: 'REG-A', category: 'MINI_TRUCK', status: 'VERIFIED', active: true, documents: [rc, insurance] },
    { id: 'b', makeModel: 'Other model', registrationNumber: 'REG-B', category: 'PICKUP_TRUCK', status: 'SUBMITTED', active: false, documents: [{ ...rc, id: 'rc-b' }] }], activeVehicle: null };
jest.mock('../src/hooks/useDriverOnboarding', () => ({ useDriverOnboarding: () => ({ summary: mockSummary, loading: false, error: null, refresh: mockRefresh }) }));
jest.mock('../src/hooks/usePartnerProfile', () => ({ usePartnerProfile: () => ({ profile: { name: mockSummary.profileName, photoUrl: null }, loading: false, error: null, refresh: mockRefresh }) }));
jest.mock('../src/hooks/useDocumentPreview', () => ({ useSecureDocumentScreen: jest.fn(), useDocumentPreview: jest.fn(), useDocumentPage: jest.fn() }));
const nativePreview = { handle: 'opaque', name: 'Driver photo', status: 'VERIFIED', contentType: 'image/jpeg', pageCount: 1, pages: [{ width: 800, height: 1200 }], expiresAt: Date.now() + 60000 };
const retry = jest.fn();
let view: Renderer.ReactTestRenderer;
const render = async (node: React.ReactElement) => { await act(() => { view = Renderer.create(node); }); };
const text = () => view.root.findAllByType(Text).map(node => node.props.children);
const navigation = { navigate: jest.fn(), goBack: jest.fn() };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useDocumentPreview).mockReturnValue({ preview: nativePreview, loading: false, error: null, retry });
  jest.mocked(useDocumentPage).mockReturnValue({ uri: 'data:image/png;base64,test-only-fixture', error: false });
});
afterEach(async () => { if (view) await act(() => view.unmount()); jest.restoreAllMocks(); });

test('Account keeps document access, one settings entry and confirmed sign out', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  await render(<ProfileScreen navigation={navigation as never} />);
  expect(text()).not.toContain('profile.proPlan'); expect(text()).not.toContain('profile.manage'); expect(text()).not.toContain('profile.activeUntil');
  expect(text()).toContain('Documents');
  expect(view.root.findAllByType(DocumentCard)).toHaveLength(0);
  expect(view.root.findAllByType(Image)).toHaveLength(0);
  await act(() => view.root.findAllByType(Pressable).find(node => node.props.accessibilityLabel === 'Documents')!.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('DocumentsHub');
  navigation.navigate.mockClear();
  const pressText = (value: string) => view.root.findAllByType(Pressable).find(node => node.findAllByType(Text).some(t => t.props.children === value))!;
  expect(text()).not.toContain('profile.language');
  await act(() => { pressText('profile.settings').props.onPress(); pressText('Sign out').props.onPress(); });
  expect(navigation.navigate.mock.calls).toEqual([['Settings']]);
  expect(view.root.findAllByType(Pressable).some(node => node.props.accessibilityLabel === 'Notifications')).toBe(false);
  const buttons = alert.mock.calls[0][2]!;
  await act(async () => buttons.find(button => button.style === 'destructive')!.onPress!());
  expect(mockLogout).toHaveBeenCalled();
});
test('Identity rows show actual thumbnails/status/rejection and open the correct record', async () => {
  await render(<PersonalDocumentsScreen navigation={navigation as never} />);
  expect(text()).toContain('Rejected'); expect(text()).toContain('Photo is blurred');
  expect(text()).not.toContain('Overall KYC status');
  expect(view.root.findAllByType(DocumentCard).map(card => card.props.document.record.id)).toEqual(['photo', 'licence', 'aadhaar']);
  const thumbnail = view.root.findAllByType(Image).find(node => node.props.accessibilityLabel === 'Driver photo preview')!;
  expect(thumbnail.props.resizeMode).toBe('contain'); expect(thumbnail.props.source.uri).toMatch(/^data:/);
  await act(() => view.root.findAllByType(Pressable).find(node => node.props.accessibilityLabel === 'View Driver photo')!.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('DocumentPreview', { kind: 'KYC', documentId: 'photo' });
});
test('Vehicle list is scoped to the explicitly viewed vehicle, even when another is active', async () => {
  await render(<VehicleDocumentsScreen navigation={navigation as never} route={{ params: { vehicleId: 'b' } } as never} />);
  const cards = view.root.findAllByType(DocumentCard);
  expect(cards).toHaveLength(1); expect(cards[0].props.document.ref).toEqual({ kind: 'VEHICLE', documentId: 'rc-b', vehicleId: 'b' });
  expect(text()).toContain('Other model'); expect(text()).toContain('Submitted');
  await act(() => cards[0].props.onView());
  expect(navigation.navigate).toHaveBeenCalledWith('DocumentPreview', { kind: 'VEHICLE', documentId: 'rc-b', vehicleId: 'b' });
});
test('missing preview and retry do not change verified document status', async () => {
  jest.mocked(useDocumentPreview).mockReturnValue({ preview: null, loading: false, error: 'Preview unavailable', retry });
  jest.mocked(useDocumentPage).mockReturnValue({ uri: null, error: false });
  await render(<PersonalDocumentsScreen navigation={navigation as never} />);
  expect(text()).toContain('Verified'); expect(text()).toContain('Preview unavailable');
  expect(view.root.findAllByType(Image)).toHaveLength(0);
  await act(() => view.root.findAllByType(Pressable).find(node => node.props.accessibilityLabel === 'Retry Driver photo preview')!.props.onPress());
  expect(retry).toHaveBeenCalled();
});
test('PDF viewer provides all pages, current page indicator and back navigation', async () => {
  jest.mocked(useDocumentPreview).mockReturnValue({ preview: { ...nativePreview, name: 'Registration certificate (RC)', contentType: 'application/pdf', pageCount: 2, pages: [{ width: 600, height: 800 }, { width: 600, height: 800 }] }, loading: false, error: null, retry });
  await render(<DocumentPreviewScreen navigation={navigation as never} route={{ params: { kind: 'VEHICLE', documentId: 'rc-b', vehicleId: 'b' } } as never} />);
  const list = view.root.findByType(FlatList);
  expect(list.props.data).toHaveLength(2); expect(list.props.initialNumToRender).toBe(1);
  expect(text()).toContain('Verified');
  await act(() => list.props.onViewableItemsChanged({ viewableItems: [{ index: 1 }] }));
  expect(text().flat().some(value => typeof value === 'string' && value.includes('Page 2 of 2'))).toBe(true);
  const header = view.root.findAll(node => node.props?.onBackPress)[0];
  await act(() => header.props.onBackPress()); expect(navigation.goBack).toHaveBeenCalled();
});

test('Documents Hub separates three document categories from vehicle management', async () => {
  await render(<DocumentsHubScreen navigation={navigation as never} route={{} as never} />);
  const cards = view.root.findAllByType(Pressable);
  expect(cards.filter(card => ['Personal documents', 'Vehicle documents', 'KYC status', 'Vehicle details'].includes(card.props.accessibilityLabel))).toHaveLength(4);
  for (const title of ['Personal documents', 'Vehicle documents', 'KYC status', 'Vehicle details']) {
    await act(() => cards.find(card => card.props.accessibilityLabel === title)!.props.onPress());
  }
  expect(navigation.navigate.mock.calls).toEqual([['PersonalDocuments'], ['VehicleDocuments'], ['KYCStatus'], ['VehicleStatus']]);
});
test('KYC overview preserves aggregate state, rejected reasons and missing required documents', async () => {
  await render(<KYCStatusScreen navigation={navigation as never} route={{} as never} />);
  expect(text()).toContain('Overall KYC status'); expect(text()).toContain('Pending review');
  expect(text()).toContain('Rejected'); expect(text()).toContain('Photo is blurred'); expect(text()).toContain('Not submitted');
  expect(view.root.findAllByType(DocumentCard)).toHaveLength(0);
  await act(() => view.root.findAllByType(Pressable).find(node => node.props.accessibilityLabel === 'Open Driving licence in Personal Documents')!.props.onPress());
  expect(navigation.navigate).toHaveBeenCalledWith('PersonalDocuments', { documentId: 'licence' });
});
test.each(['VERIFIED', 'IN_REVIEW', 'REJECTED'])('KYC aggregate %s comes from the backend', async status => {
  const previous = mockSummary.kyc.status;
  mockSummary.kyc.status = status;
  try {
    await render(<KYCStatusScreen navigation={navigation as never} route={{} as never} />);
    expect(text()).toContain({ VERIFIED: 'Verified', IN_REVIEW: 'Pending review', REJECTED: 'Rejected' }[status]);
    expect(text()).not.toContain('undefined');
  } finally { mockSummary.kyc.status = previous; }
});
test('Vehicle Details uses the active registration and its actual RC/Insurance records', async () => {
  await render(<VehicleDocumentsScreen navigation={navigation as never} />);
  expect(text()).toContain('Actual model');
  expect(view.root.findAllByType(DocumentCard).map(card => card.props.document.record.id)).toEqual(['rc-a', 'insurance-a']);
});
test('Hub rows share the compact grouped treatment and can grow for long content', async () => {
  await render(<DocumentsHubScreen navigation={navigation as never} route={{} as never} />);
  const cards = view.root.findAllByType(DocumentNavigationCard);
  expect(cards).toHaveLength(4);
  for (const card of cards) {
    const glyphs = card.findAllByType(Icon);
    expect(glyphs[0].props.color).toBe(card.props.mint ? colors.homeGreen : colors.navigationIcon);
    expect(glyphs[0].props.size).toBe(21);
    expect(StyleSheet.flatten(glyphs[0].parent!.props.style)).toMatchObject({ width: 36, height: 36, backgroundColor: card.props.mint ? colors.homeMint : colors.surfaceContainerLow });
    expect(glyphs[1].props.color).toBe(colors.onSurfaceMuted);
    const button = card.findByType(Pressable);
    const normal = StyleSheet.flatten(button.props.style({ pressed: false }));
    expect(normal).toMatchObject({ minHeight: 64 });
    expect(normal.height).toBeUndefined(); expect(normal.maxHeight).toBeUndefined();
    expect(StyleSheet.flatten(button.props.style({ pressed: true })).backgroundColor).toBe(colors.surfaceContainerLow);
    for (const label of card.findAllByType(Text)) expect(label.props.numberOfLines).toBeUndefined();
  }
  expect(StyleSheet.flatten(view.root.findByType(ScrollView).props.contentContainerStyle)).toMatchObject({ width: '100%', maxWidth: 720, alignSelf: 'center' });
});
test('Profile Documents uses the grouped mint row without rendering previews', async () => {
  await render(<ProfileScreen navigation={navigation as never} />);
  const card = view.root.findByType(DocumentNavigationCard);
  const glyph = card.findAllByType(Icon)[0];
  expect(glyph.props).toMatchObject({ name: 'folder_open', color: colors.homeGreen, size: 21 });
  expect(view.root.findAllByType(DocumentCard)).toHaveLength(0);
});
