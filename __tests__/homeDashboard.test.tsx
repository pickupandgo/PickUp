import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text } from 'react-native';
import { HomeDashboardService, businessDate, currentVehicle, validateToday, type DailyEarnings } from '../src/services/dashboard/HomeDashboardService';
import { DriverOnboardingService, type DriverOnboardingSummary, type OnboardingVehicle, type VehicleCategory } from '../src/services/onboarding/DriverOnboardingService';
import { getPaymentsApi } from '../src/services/payments';
import { CurrentVehicleCard } from '../src/components/molecules/CurrentVehicleCard';
import { EarningsCard } from '../src/components/molecules/EarningsCard';
import { WalletCard } from '../src/components/molecules/WalletCard';
import { VehicleAvatar, categoryArtwork } from '../src/components/atoms/VehicleAvatar';
import { DashboardAction } from '../src/components/molecules/DashboardAction';
import { colors } from '../src/theme';

jest.mock('../src/services/payments', () => ({ getPaymentsApi: jest.fn() }));
jest.mock('react-native', () => Object.defineProperties({}, {
  ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native')),
  Pressable: { value: 'Pressable' },
}));
jest.mock('../src/components/atoms/Icon', () => 'Icon');

const vehicle = (id: string, active = false, status: OnboardingVehicle['status'] = 'VERIFIED'): OnboardingVehicle =>
  ({ id, active, status, category: 'MINI_TRUCK', makeModel: `Model ${id}`, registrationNumber: `REG-${id}`, documents: [] });
const summary = (vehicles: OnboardingVehicle[], activeVehicle: OnboardingVehicle | null = null): DriverOnboardingSummary => ({
  driverId: 'driver', approvalStatus: 'APPROVED', profileComplete: true, profileName: 'Partner',
  eligible: true, eligibilityReasons: [], next: 'APPROVED', kyc: null, vehicles, activeVehicle,
  requiredDocuments: { kyc: [], vehicle: [] }, latestDecision: null,
});
const daily: DailyEarnings = { date: '2026-11-01', timeZone: 'Asia/Kolkata', currency: 'INR',
  metric: 'NET_DRIVER_EARNINGS', netAmountPaise: 0, completedTripCount: 0 };
const render = async (element: React.ReactElement) => {
  let view!: Renderer.ReactTestRenderer;
  await act(() => { view = Renderer.create(element); });
  return view;
};

test('selects the backend active vehicle even when a historical approved vehicle is first', () => {
  const a = vehicle('historical'), b = vehicle('active', true);
  expect(currentVehicle(summary([a, b], b))).toBe(b);
  expect(currentVehicle(summary([a, b]))).toBe(b);
});
test('does not choose arbitrarily among multiple unselected registrations', () => {
  expect(currentVehicle(summary([vehicle('a'), vehicle('b')]))).toBeNull();
  expect(currentVehicle(summary([]))).toBeNull();
});
test.each(['VERIFIED', 'SUBMITTED', 'REJECTED'] as const)('single registration preserves %s', status => {
  const a = vehicle('a', false, status);
  expect(currentVehicle(summary([a]))).toBe(a);
});
test('ambiguous active flags fail closed', () => {
  expect(currentVehicle(summary([vehicle('a', true), vehicle('b', true)]))).toBeNull();
});
test.each([
  ['2026-10-31T18:29:59.999Z', '2026-10-31'],
  ['2026-10-31T18:30:00.000Z', '2026-11-01'],
  ['2026-11-01T18:30:00.000Z', '2026-11-02'],
])('IST date boundary at %s', (instant, expected) => expect(businessDate(new Date(instant))).toBe(expected));
test.each([[0, 0], [65000, 1], [125050, 4]])('accepts backend daily values %i paise, %i trips', (netAmountPaise, completedTripCount) => {
  const data = { ...daily, netAmountPaise, completedTripCount };
  expect(validateToday(data, daily.date)).toBe(data);
});
test('rejects yesterday, invalid money and the wrong business metric', () => {
  expect(() => validateToday(daily, '2026-11-02')).toThrow();
  expect(() => validateToday({ ...daily, netAmountPaise: NaN }, daily.date)).toThrow();
  expect(() => validateToday({ ...daily, completedTripCount: -1 }, daily.date)).toThrow();
});
test('daily adapter stays unavailable until a real daily backend contract exists', async () => {
  await expect(new HomeDashboardService().getToday(daily.date)).rejects.toThrow('currently unavailable');
});
test('future daily adapter propagates backend failure and rejects stale dates', async () => {
  await expect(new HomeDashboardService({ getToday: async () => { throw new Error('offline'); } }).getToday(daily.date)).rejects.toThrow('offline');
  await expect(new HomeDashboardService({ getToday: async () => daily }).getToday('2026-11-02')).rejects.toThrow('verified');
});
test('vehicles use the existing authenticated onboarding service', async () => {
  const data = summary([vehicle('actual', true)]);
  const spy = jest.spyOn(DriverOnboardingService.getInstance(), 'getSummary').mockResolvedValue(data);
  expect(await new HomeDashboardService().getVehicles()).toBe(data);
  spy.mockRestore();
});
test.each([0, 125050])('wallet maps the server ledger balance %i paise without adding pending money', async balancePaise => {
  jest.mocked(getPaymentsApi).mockReturnValue({ getWallet: async () => ({ walletId: 'wallet', status: 'ACTIVE', balancePaise, updatedAt: '2026-11-01T00:00:00Z' }) } as ReturnType<typeof getPaymentsApi>);
  expect((await new HomeDashboardService().getWallet()).balance).toBe(balancePaise / 100);
});
test('empty or malformed vehicle responses become errors instead of a fabricated vehicle', async () => {
  const spy = jest.spyOn(DriverOnboardingService.getInstance(), 'getSummary').mockResolvedValue(null as unknown as DriverOnboardingSummary);
  await expect(new HomeDashboardService().getVehicles()).rejects.toThrow('verified');
  spy.mockRestore();
});
test('wallet failures and absent backend never return sample/zero balance', async () => {
  jest.mocked(getPaymentsApi).mockReturnValue(null);
  await expect(new HomeDashboardService().getWallet()).rejects.toThrow('unavailable');
  jest.mocked(getPaymentsApi).mockReturnValue({ getWallet: async () => { throw new Error('unauthorized'); } } as unknown as ReturnType<typeof getPaymentsApi>);
  await expect(new HomeDashboardService().getWallet()).rejects.toThrow('unauthorized');
});
test.each(['SUBMITTED', 'IN_REVIEW', 'REJECTED', 'VERIFIED'] as const)('vehicle card displays actual %s status and registration', async status => {
  const v = vehicle('real', true, status);
  const view = await render(<CurrentVehicleCard resource={{ data: summary([v], v), loading: false, error: null }} onManage={jest.fn()} onRetry={jest.fn()} />);
  const texts = view.root.findAllByType(Text).map(n => n.props.children);
  expect(texts).toContain('REG-real'); expect(texts).toContain('Model real');
  expect(texts).toContain(status.replace(/_/g, ' '));
  expect(texts).not.toContain('APPROVED');
  await act(() => view.unmount());
});
test('vehicle loading/error never renders an approved badge or fabricated model', async () => {
  const view = await render(<CurrentVehicleCard resource={{ data: null, loading: true, error: null }} onManage={jest.fn()} onRetry={jest.fn()} />);
  expect(view.root.findAllByType(ActivityIndicator)).toHaveLength(1);
  await act(() => view.update(<CurrentVehicleCard resource={{ data: null, loading: false, error: 'Network unavailable' }} onManage={jest.fn()} onRetry={jest.fn()} />));
  expect(view.root.findAllByType(VehicleAvatar)).toHaveLength(0);
  expect(view.root.findAllByType(Text).some(n => n.props.children === 'Network unavailable')).toBe(true);
  await act(() => view.unmount());
});
test('empty vehicle card opens registration action', async () => {
  const manage = jest.fn();
  const view = await render(<CurrentVehicleCard resource={{ data: summary([]), loading: false, error: null }} onManage={manage} onRetry={jest.fn()} />);
  await act(() => view.root.findByType(DashboardAction).props.onPress());
  expect(manage).toHaveBeenCalledTimes(1);
  await act(() => view.unmount());
});
test.each([['TWO_WHEELER', 'bike'], ['THREE_WHEELER', 'threeWheeler'], ['FOUR_WHEELER', 'miniTruck'], ['MINI_TRUCK', 'miniTruck'], ['PICKUP_TRUCK', 'pickup']] as const)('maps %s to its vehicle illustration', async (category, artwork) => {
  const view = await render(<VehicleAvatar vehicle={category as VehicleCategory} />);
  expect(categoryArtwork[category]).toBe(artwork);
  expect(view.root.findByType(Image).props.testID).toBe(`vehicle-avatar-${category}`);
  await act(() => view.unmount());
});
test('money cards distinguish unavailable from genuine zero, and keep actions usable', async () => {
  const details = jest.fn(), recharge = jest.fn();
  const view = await render(<><EarningsCard label="TODAY" amount={null} currency="₹" error="Unavailable" onDetailsPress={details} />
    <WalletCard label="WALLET" balance={0} currency="₹" minimumBalance={null} onRechargePress={recharge} /></>);
  const text = view.root.findAllByType(Text).map(n => n.props.children);
  expect(text).toContain('—'); expect(text).toContain('₹0');
  const actions = view.root.findAllByType(Pressable);
  await act(() => { actions[0].props.onPress(); actions[1].props.onPress(); });
  expect(details).toHaveBeenCalled(); expect(recharge).toHaveBeenCalled();
  for (const action of actions) {
    expect(StyleSheet.flatten(action.props.style({ pressed: false })).backgroundColor).toBe(colors.surfaceContainerLowest);
    expect(StyleSheet.flatten(action.props.style({ pressed: true })).backgroundColor).toBe(colors.secondaryContainer);
    expect(StyleSheet.flatten(action.findByType(Text).props.style).color).toBe(colors.startupBlueDark);
  }
  await act(() => view.unmount());
});

test.each([
  [0, 0, '₹0'],
  [1250.5, 3, '₹1,250.50'],
  [null, undefined, '—'],
] as const)('compact Today preserves amount %s and completed trips', async (amount, trips, formatted) => {
  const view = await render(<EarningsCard label="TODAY" amount={amount} currency="₹" tripCount={trips} onDetailsPress={jest.fn()} />);
  const text = view.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain(formatted);
  expect(text.includes('Earnings unavailable')).toBe(amount === null);
  if (trips !== undefined) {
    expect(view.root.findAllByType(Text).some(node => Array.isArray(node.props.children) && node.props.children[0] === trips)).toBe(true);
  }
  await act(() => view.unmount());
});

test.each([0, 9876.5])('compact Wallet preserves actual balance %s', async balance => {
  const view = await render(<WalletCard label="WALLET" balance={balance} currency="₹" minimumBalance={null} onRechargePress={jest.fn()} />);
  expect(view.root.findAllByType(Text).map(node => node.props.children)).toContain(balance === 0 ? '₹0' : '₹9,876.50');
  expect(view.root.findByType(DashboardAction).props.label).toBe('RECHARGE');
  await act(() => view.unmount());
});

test('long earnings failure stays compact without visually rendering the full error', async () => {
  const error = 'Today’s earnings are currently unavailable. View details for your earnings history. '.repeat(8);
  const view = await render(<EarningsCard label="TODAY" amount={null} currency="₹" error={error} onDetailsPress={jest.fn()} />);
  const notice = view.root.findAllByType(Text).find(node => node.props.children === 'Earnings unavailable')!;
  expect(notice).toBeDefined();
  expect(notice.props.accessibilityLabel).toBe(error);
  expect(notice.props.numberOfLines).toBeUndefined();
  expect(view.root.findAllByType(Text).map(node => node.props.children)).not.toContain(error);
  expect(view.root.findByType(DashboardAction).props.label).toBe('DETAILS');
  await act(() => view.unmount());
});

test('cards share compact minimum sizing and allow content to grow without a height clamp', async () => {
  const view = await render(<><EarningsCard label="TODAY" amount={null} currency="₹" error="Unavailable" onDetailsPress={jest.fn()} testID="compact-today" />
    <WalletCard label="WALLET" balance={500} currency="₹" minimumBalance={null} onRechargePress={jest.fn()} testID="compact-wallet" /></>);
  const rootStyle = (id: string) => StyleSheet.flatten(view.root.findAll(node => node.props?.testID === id && Array.isArray(node.props.style))[0].props.style);
  const today = rootStyle('compact-today'), wallet = rootStyle('compact-wallet');
  expect(today.minHeight).toBe(164); expect(wallet.minHeight).toBe(today.minHeight);
  expect(today.padding).toBe(12); expect(wallet.padding).toBe(today.padding);
  for (const style of [today, wallet]) {
    expect(style.flex).toBe(1); expect(style.height).toBeUndefined(); expect(style.maxHeight).toBeUndefined();
  }
  for (const action of view.root.findAllByType(DashboardAction)) {
    expect(StyleSheet.flatten(action.props.style).maxWidth).toBe('100%');
  }
  await act(() => view.unmount());
});
