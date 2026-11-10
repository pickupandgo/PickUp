import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { useEngineTripHistory as useTripHistory } from '../src/hooks/useEngineTripHistory';
import { useHistoricalTrip } from '../src/hooks/useHistoricalTrip';
import { TripEarningCard } from '../src/components/molecules/TripEarningCard';
import { DriverHistoryDetail } from '../src/screens/trips/HistoricalTripDetailScreen';
jest.mock('../src/components/atoms/Icon', () => 'Icon');

let mockUid = 'driver-a';
const mockPage = jest.fn(),
  mockTrip = jest.fn(),
  mockEarning = jest.fn();
jest.mock('../src/services/engine/dispatch', () => ({
  getCurrentDriverId: () => mockUid,
  getDriverHistoryPage: (...args: unknown[]) => mockPage(...args),
  getTripById: (...args: unknown[]) => mockTrip(...args),
  engineTripToHistoricalTrip: (value: unknown) => value,
}));
jest.mock('../src/services/payments', () => ({
  getPaymentsApi: () => ({ getTripEarning: mockEarning }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) =>
    jest.requireActual('react').useEffect(callback, [callback]),
}));
let history: ReturnType<typeof useTripHistory>,
  detail: ReturnType<typeof useHistoricalTrip>;
function History() {
  history = useTripHistory();
  return null;
}
function Detail({ id }: { id: string }) {
  detail = useHistoricalTrip(id);
  return null;
}
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const mount = async (element: React.ReactElement) => {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(element);
  });
  await act(async () => {
    await flush();
  });
  return view;
};
const text = (view: Renderer.ReactTestRenderer) =>
  view.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
beforeEach(() => {
  mockUid = 'driver-a';
  mockPage.mockReset().mockResolvedValue({ trips: [], nextCursor: null });
  mockTrip.mockReset();
  mockEarning.mockReset().mockResolvedValue(null);
});

test('empty/failing history never inserts sample trips; retry loads server rows', async () => {
  mockPage.mockRejectedValueOnce(new Error('offline'));
  const view = await mount(<History />);
  expect(history.trips).toEqual([]);
  expect(history.error).toContain('could not be loaded');
  mockPage.mockResolvedValue({ trips: [{ id: 'real-a' }], nextCursor: null });
  await act(async () => {
    await history.fetchHistory();
  });
  expect(history.trips.map(trip => trip.id)).toEqual(['real-a']);
  expect(history.error).toBeNull();
  await act(async () => view.unmount());
});
test('pagination deduplicates rows and a failed next page keeps the loaded history', async () => {
  mockPage.mockResolvedValueOnce({
    trips: [{ id: 'a' }],
    nextCursor: 'cursor-a',
  });
  const view = await mount(<History />);
  mockPage.mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await history.loadMore();
  });
  expect(history.trips.map(trip => trip.id)).toEqual(['a']);
  expect(history.nextCursor).toBe('cursor-a');
  mockPage.mockResolvedValue({
    trips: [{ id: 'a' }, { id: 'b' }],
    nextCursor: null,
  });
  await act(async () => {
    await history.loadMore();
  });
  expect(mockPage).toHaveBeenLastCalledWith('cursor-a');
  expect(history.trips.map(trip => trip.id)).toEqual(['a', 'b']);
  await act(async () => view.unmount());
});
test('a previous account history response cannot populate the new account', async () => {
  const old = pending<unknown>();
  mockPage.mockReturnValueOnce(old.promise);
  const view = await mount(<History />);
  mockUid = 'driver-b';
  await act(async () => {
    view.update(<History />);
    await flush();
  });
  await act(async () => {
    old.resolve({ trips: [{ id: 'private-a' }], nextCursor: null });
    await flush();
  });
  expect(history.trips).toEqual([]);
  await act(async () => view.unmount());
});
test('selected detail changes immediately and ignores an older slow trip response', async () => {
  const old = pending<unknown>();
  mockTrip.mockReturnValueOnce(old.promise);
  const view = await mount(<Detail id="a" />);
  mockTrip.mockResolvedValue({ id: 'b', driverId: 'driver-a' });
  await act(async () => {
    view.update(<Detail id="b" />);
    await flush();
  });
  await act(async () => {
    old.resolve({ id: 'a', driverId: 'driver-a' });
    await flush();
  });
  expect(detail.trip?.id).toBe('b');
  expect(mockTrip).toHaveBeenLastCalledWith('b');
  await act(async () => view.unmount());
});
test('a wrong trip/driver detail is an error, not a fallback', async () => {
  mockTrip.mockResolvedValue({ id: 'other', driverId: 'driver-b' });
  const view = await mount(<Detail id="a" />);
  expect(detail.trip).toBeNull();
  expect(detail.error).toContain('could not be loaded');
  await act(async () => view.unmount());
});
test('two selected trip screens show their own route and request their matching financial record', async () => {
  const make = (id: string) => ({
    id,
    driverId: 'driver-a',
    paymentTripId: `payment-${id}`,
    date: '08/11/2026',
    time: '10:00',
    status: 'completed',
    stops: [
      {
        id: `pickup-${id}`,
        label: 'Pickup',
        address: `Pickup ${id}`,
        type: 'pickup',
        status: 'completed',
      },
    ],
    vehicleType: `Vehicle ${id}`,
    totalWeight: '10 kg',
    customerFarePaise: 6820,
  });
  mockTrip.mockImplementation(async (id: string) => make(id));
  const view = await mount(
    <DriverHistoryDetail tripId="a" onBack={jest.fn()} />,
  );
  expect(text(view)).toContain('Pickup a');
  expect(text(view)).toContain('Vehicle a');
  await act(async () => {
    view.update(<DriverHistoryDetail tripId="b" onBack={jest.fn()} />);
    await flush();
  });
  await act(async () => {
    await flush();
  });
  expect(text(view)).toContain('Pickup b');
  expect(text(view)).not.toContain('Pickup a');
  expect(mockEarning).toHaveBeenLastCalledWith('payment-b');
  await act(async () => view.unmount());
});
test('the earnings card uses backend paise and explicit mixed/hold status', async () => {
  mockEarning.mockResolvedValue({
    tripId: 'payment-a',
    status: 'ON_HOLD',
    settlement: 'MIXED',
    grossAmountPaise: 6820,
    platformFeePaise: 620,
    otherDeductionsPaise: 0,
    tdsAmountPaise: 0,
    netAmountPaise: 6200,
    netCashPaise: 2000,
    payoutAmountPaise: 4200,
  });
  const view = await mount(<TripEarningCard tripId="payment-a" />);
  expect(mockEarning).toHaveBeenCalledWith('payment-a');
  expect(text(view)).toContain('On hold');
  expect(text(view)).toContain('Cash + online');
  expect(text(view)).toContain('68.20');
  expect(text(view)).toContain('6.20');
  expect(text(view)).toContain('Net driver earnings');
  expect(text(view)).not.toContain('Paid to wallet');
  await act(async () => view.unmount());
});
test('missing/failed earnings are not zero or paid, and old trip amounts cannot reappear', async () => {
  const old = pending<unknown>();
  mockEarning.mockReturnValueOnce(old.promise);
  const view = await mount(<TripEarningCard tripId="payment-a" />);
  mockEarning.mockRejectedValue(new Error('offline'));
  await act(async () => {
    view.update(<TripEarningCard tripId="payment-b" />);
    await flush();
  });
  await act(async () => {
    old.resolve({ tripId: 'payment-a', netAmountPaise: 999999 });
    await flush();
  });
  expect(text(view)).toContain('could not be loaded');
  expect(text(view)).not.toContain('999');
  mockEarning.mockResolvedValue(null);
  await act(async () => {
    view.update(<TripEarningCard tripId="payment-c" />);
    await flush();
  });
  expect(text(view)).toContain('No earning record');
  await act(async () => view.unmount());
});
