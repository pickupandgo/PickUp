import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { TripCompletedScreen } from '../src/screens/trip/TripCompletedScreen';
import type { ActiveTrip } from '../src/types/trip';
import type { TripHistoryRecord } from '../src/types/tripHistory';

jest.mock('../src/components/atoms/Icon', () => 'Icon');
let mockTrip: ActiveTrip | null = null;
let mockRecord: TripHistoryRecord | null = null;
jest.mock('../src/hooks/useActiveTrip', () => ({ useLiveTrip: () => mockTrip }));
jest.mock('../src/hooks/useTripHistory', () => ({ useTripHistory: () => ({ items: mockRecord ? [mockRecord] : [], financeLoading: false }) }));
jest.mock('../src/hooks/useCollectableTrips', () => ({ useCollectableTrips: () => [] }));
jest.mock('../src/services/trip/TripController', () => ({ TripController: { getInstance: () => ({ clearTrip: jest.fn() }) } }));
let view: Renderer.ReactTestRenderer;
const props = { route: { params: { tripId: 'trip' } }, navigation: { popToTop: jest.fn(), getParent: jest.fn() } } as unknown as React.ComponentProps<typeof TripCompletedScreen>;
const text = () => view.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ');
beforeEach(() => { mockTrip = null; mockRecord = null; });
afterEach(async () => { if (view) await act(() => view.unmount()); });
test('missing trip never renders sample data or a successful completion', async () => {
  await act(() => { view = Renderer.create(<TripCompletedScreen {...props} />); });
  expect(text()).toContain('Checking trip completion'); expect(text()).toContain('Earnings unavailable');
  expect(text()).not.toContain('₹'); expect(text()).not.toContain('Trip Completed!');
});
test('DELIVERED is not COMPLETED and customer fare is not Partner earnings', async () => {
  mockTrip = { id: 'trip', status: 'drop_verified', engineStatus: 'DELIVERED', estimatedEarning: 99999, stops: [] } as unknown as ActiveTrip;
  await act(() => { view = Renderer.create(<TripCompletedScreen {...props} />); });
  expect(text()).toContain('Checking trip completion'); expect(text()).not.toContain('99999');
});
test('same-trip backend completion is required for the successful summary', async () => {
  mockRecord = { id: 'trip', status: 'COMPLETED', vehicleCategory: 'MINI_TRUCK', weightKg: 10, distanceKm: null, stops: [], earning: null } as unknown as TripHistoryRecord;
  await act(() => { view = Renderer.create(<TripCompletedScreen {...props} />); });
  expect(text()).not.toContain('Checking trip completion'); expect(text()).toContain('10 kg');
  expect(text()).toContain('Model and registration were not recorded'); expect(text()).toContain('Earnings unavailable');
});
