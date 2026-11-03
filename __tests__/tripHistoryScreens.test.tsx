import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { FlatList, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { VehicleAvatar } from '../src/components/atoms/VehicleAvatar';
import { TripLoadingSkeleton } from '../src/components/trips/TripLoadingSkeleton';
import { historyTimeline } from '../src/services/trip/tripHistoryPresentation';
import { TripHistoryScreen } from '../src/screens/trips/TripHistoryScreen';
import { HistoricalTripDetailScreen } from '../src/screens/trips/HistoricalTripDetailScreen';
import { TripHistoryCard } from '../src/components/trips/TripHistoryCard';
import { useTripHistory } from '../src/hooks/useTripHistory';
import { historyTrip, earning, uuid } from '../__fixtures__/tripHistory';
jest.mock('react-native', () => Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(jest.requireActual('react-native')), Pressable: { value: 'Pressable' } }));
jest.mock('../src/hooks/useTripHistory');
jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => ({ 'tripHistory.title': 'Trip History', 'tripHistory.all': 'All Trips', 'tripHistory.completed': 'Completed', 'tripHistory.cancelled': 'Cancelled' }[key] ?? key) }) }));
const refresh = jest.fn(async () => {});
const navigate = jest.fn(); const goBack = jest.fn();
const base = { uid: 'partner-test-uid', items: [historyTrip(), historyTrip({ id: uuid(99), status: 'CANCELLED', cancellationReason: 'Customer cancellation from server', completedAt: null, cancelledAt: '2026-11-03T00:00:00Z' })],
  counts: { all: 2, completed: 1, cancelled: 1 }, truncated: false, ready: true, loading: false, refreshing: false, financeLoading: false, error: null, financeError: null, refresh };
let view: Renderer.ReactTestRenderer;
const render = async () => { await act(() => { view = Renderer.create(<TripHistoryScreen navigation={{ navigate } as never} />); }); };
const text = () => view.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ').replace(/\s+/g, ' ');
const press = (label: string) => view.root.findAll(node => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress();
beforeEach(() => { jest.mocked(useTripHistory).mockReturnValue(base); jest.clearAllMocks(); });
afterEach(async () => { if (view) await act(() => view.unmount()); });
test('All, Completed and Cancelled filter actual statuses and preserve selection after refresh', async () => {
  await render(); expect(view.root.findByType(FlatList).props.data).toHaveLength(2); expect(text()).toContain('All Trips');
  await act(() => press('Completed')); expect(view.root.findByType(FlatList).props.data.map((item: { status: string }) => item.status)).toEqual(['COMPLETED']);
  await act(async () => view.root.findByType(FlatList).props.refreshControl.props.onRefresh()); expect(refresh).toHaveBeenCalled();
  expect(view.root.findByType(FlatList).props.data).toHaveLength(1);
  await act(() => press('Cancelled')); expect(view.root.findByType(FlatList).props.data[0].cancellationReason).toBe('Customer cancellation from server');
});
test('card opens dedicated detail with the real engine UUID, not the booking label', async () => {
  await render();
  const card = view.root.findByType(FlatList).props.renderItem({ item: base.items[0] });
  await act(() => view.update(card));
  await act(() => press('View trip details'));
  expect(navigate).toHaveBeenCalledWith('HistoricalTripDetail', { tripId: uuid(1) });
});
test('empty state appears for a genuine successful zero result, not during loading or errors', async () => {
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [], ready: false, loading: true, counts: null }); await render();
  expect(view.root.findAllByType(TripLoadingSkeleton)).toHaveLength(1); expect(text()).not.toContain('No trips found');
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [], ready: false, loading: false, counts: null, error: 'Sign in again' });
  await act(() => view.update(<TripHistoryScreen navigation={{ navigate } as never} />));
  expect(text()).toContain('Sign in again'); expect(text()).not.toContain('No trips found');
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [], counts: { all: 0, completed: 0, cancelled: 0 } });
  await act(() => view.update(<TripHistoryScreen navigation={{ navigate } as never} />)); expect(text()).toContain('No trips found');
});
test('a filtered empty capped window never claims that no older matching trips exist', async () => {
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [base.items[1]], counts: null, truncated: true }); await render();
  await act(() => press('Completed')); expect(text()).toContain('Limited trip history'); expect(text()).not.toContain('No trips found');
});
test('compact rows show short pickup/destination, missing historical vehicle, stop summary and real net', async () => {
  await act(() => { view = Renderer.create(<TripHistoryCard trip={{ ...historyTrip(), earning: earning() }} onPress={navigate} />); });
  expect(text()).toContain('Backend pickup address → Backend second drop'); expect(text()).not.toContain('Backend first drop'); expect(text()).toContain('2 stops'); expect(text()).toContain('Mini truck');
  expect(text()).toContain('₹1,700'); expect(text()).toContain('Completed');
  expect(text()).not.toMatch(/LOG-9921|Industrial Park|Paid to Wallet|₹99,999/);
});
test('missing financials are a dash; true zero is zero; cancellation reason is not hardcoded', async () => {
  await act(() => { view = Renderer.create(<TripHistoryCard trip={base.items[1]} onPress={navigate} />); });
  expect(text()).toContain('Cancelled'); expect(text()).not.toContain('Customer cancellation from server'); expect(text()).toContain('Earnings unavailable'); expect(text()).not.toContain('₹0');
  await act(() => view.update(<TripHistoryCard trip={{ ...historyTrip(), earning: earning({ netAmountPaise: 0 }) }} onPress={navigate} />));
  expect(text()).toContain('₹0');
});
test('IDs are absent from visible/accessibility content but real UUID remains the navigation key', async () => {
  const trip = historyTrip({ externalRef: null, vehicleType: 'TWO_WHEELER' });
  await act(() => { view = Renderer.create(<TripHistoryCard trip={trip} onPress={navigate} />); });
  expect(text()).not.toContain(trip.id); expect(text()).not.toContain(trip.id.slice(0, 8)); expect(text()).not.toContain('actual-booking-reference');
  const button = view.root.findByType(Pressable); const style = StyleSheet.flatten(button.props.style({ pressed: false }));
  expect(style.minHeight).toBe(108); expect(style.height).toBeUndefined(); expect(style.borderBottomWidth).toBe(1); expect(style.borderRadius).toBeUndefined();
  expect(view.root.findByType(VehicleAvatar).props).toMatchObject({ vehicle: 'TWO_WHEELER', size: 52 });
  expect(button.props.accessibilityLabel).toBe('View trip details'); expect(button.props.accessibilityHint).not.toContain(trip.id);
  await act(() => button.props.onPress()); expect(navigate).toHaveBeenCalledWith(trip.id);
});
test('details retain selected route, timestamps, metrics and earnings without any reference UI', async () => {
  const trip = { ...historyTrip({ externalRef: null }), earning: earning({ settlement: 'MIXED' }) };
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [trip] });
  await act(() => { view = Renderer.create(<HistoricalTripDetailScreen navigation={{ goBack } as never} route={{ params: { tripId: trip.id } } as never} />); });
  expect(view.root.findAllByType(ScrollView)).toHaveLength(1);
  for (const value of ['Backend pickup address', 'Backend first drop', 'Backend second drop', '12.6', '250', 'Settlement method', 'Cash + online', 'Gross earning', 'Platform fee', 'Other deductions', 'TDS']) expect(text()).toContain(value);
  expect(text()).not.toContain(trip.id); expect(text()).not.toMatch(/TRIP REFERENCE|Trip ID|View full reference|Hide reference/);
  expect(view.root.findAll(node => node.props.accessibilityLabel === 'Show full trip reference')).toHaveLength(0);
});
test('detail skeleton and unauthorized/not-found states never substitute a sample trip', async () => {
  const props = { navigation: { goBack } as never, route: { params: { tripId: uuid(1) } } as never };
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [], ready: false, loading: true });
  await act(() => { view = Renderer.create(<HistoricalTripDetailScreen {...props} />); }); expect(view.root.findByType(TripLoadingSkeleton).props.details).toBe(true);
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [], loading: false, error: 'Please sign in again to view your trips.' });
  await act(() => view.update(<HistoricalTripDetailScreen {...props} />)); expect(text()).toContain('Trip unavailable'); expect(text()).not.toContain('Backend pickup address');
});
test('timeline is chronological, includes only real events and confirmed paid settlement, and omits future events', () => {
  const trip = { ...historyTrip(), earning: earning({ status: 'PAID', paidAt: '2026-11-02T01:00:00Z' }) };
  const events = historyTimeline(trip, Date.parse('2026-11-02T02:00:00Z'));
  expect(events.at(-1)?.label).toBe('Settlement paid');
  expect(events.map(point => Date.parse(point.at))).toEqual(events.map(point => Date.parse(point.at)).sort((a, b) => a - b));
  expect(historyTimeline(trip, Date.parse('2026-11-02T00:15:00Z')).some(point => point.label === 'Trip completed' || point.label === 'Settlement paid')).toBe(false);
  expect(historyTimeline({ ...trip, earning: earning({ status: 'PAYABLE', paidAt: '2026-11-02T01:00:00Z' }) }).some(point => point.label === 'Settlement paid')).toBe(false);
});
test('cancelled details show actual reason while missing compensation stays unavailable', async () => {
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [base.items[1]] });
  await act(() => { view = Renderer.create(<HistoricalTripDetailScreen navigation={{ goBack } as never} route={{ params: { tripId: base.items[1].id } } as never} />); });
  expect(text()).toContain('Customer cancellation from server'); expect(text()).toContain('Cancellation charges unavailable'); expect(text()).not.toContain('₹0');
});
test('detail renders only its authorized record, actual route/timeline and supports Back', async () => {
  jest.mocked(useTripHistory).mockReturnValue({ ...base, items: [{ ...historyTrip(), earning: earning() }] });
  await act(() => { view = Renderer.create(<HistoricalTripDetailScreen navigation={{ goBack } as never} route={{ params: { tripId: uuid(1) } } as never} />); });
  expect(useTripHistory).toHaveBeenCalledWith(uuid(1)); expect(text()).toContain('Trip completed'); expect(text()).toContain('Backend second drop');
  expect(text()).toContain('Net partner earnings'); expect(text()).toContain('Model and registration were not recorded for this trip.');
  await act(() => press('Go back')); expect(goBack).toHaveBeenCalled();
});
