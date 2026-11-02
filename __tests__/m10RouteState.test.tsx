import React from 'react';
import Renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Text } from 'react-native';
import MultiDropOverviewScreen from '../src/screens/logistics/MultiDropOverviewScreen';
import { useRoadRoute } from '../src/hooks/useRoute';
import { getRoute } from '../src/api/directions';
import TripRouteDetailsScreen from '../src/screens/logistics/TripRouteDetailsScreen';
let mockTrip: any;
let mockLive: any;
let mockDrops: any[] = [{ address: 'First drop', receiverName: 'First receiver' }, { address: 'Second drop', receiverName: 'Second receiver' }];
const mockRemoveDrop = jest.fn();
jest.mock('../src/api/directions', () => ({ getRoute: jest.fn() }));
jest.mock('../src/state/BookingContext', () => ({
  useBooking: () => ({ trip: mockTrip, removeDrop: mockRemoveDrop, draft: { pickup: { address: 'Pickup' }, drops: mockDrops } }),
}));
jest.mock('../src/hooks/useTripStatus', () => ({
  useTripStatus: () => mockLive,
}));
const a = { latitude: 26, longitude: 73 };
const b = { latitude: 27, longitude: 73 };
const c = { latitude: 28, longitude: 73 };
let tree: ReactTestRenderer;
afterEach(() => {
  if (tree) act(() => tree.unmount());
  jest.clearAllMocks();
  mockDrops = [{ address: 'First drop', receiverName: 'First receiver' }, { address: 'Second drop', receiverName: 'Second receiver' }];
});
it('drops old geometry immediately when waypoints change and ignores late results', async () => {
  let resolveOld!: (v: any) => void;
  (getRoute as jest.Mock)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    )
    .mockResolvedValueOnce({ polyline: [a, c] });
  let route!: ReturnType<typeof useRoadRoute>;
  function Harness({ stops }: { stops: any[] }) {
    route = useRoadRoute(a, c, stops);
    return null;
  }
  await act(async () => {
    tree = Renderer.create(<Harness stops={[b]} />);
  });
  await act(async () => {
    tree.update(<Harness stops={[]} />);
  });
  expect(route.polyline).toEqual([a, c]);
  await act(async () => {
    resolveOld({ polyline: [a, b, c] });
  });
  expect(route.polyline).toEqual([a, c]);
  expect(getRoute).toHaveBeenLastCalledWith(
    a,
    c,
    expect.objectContaining({ waypoints: [] }),
  );
});
it('exposes routing failure and retry without inventing a straight line', async () => {
  (getRoute as jest.Mock)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ polyline: [a, b, c] });
  let route!: ReturnType<typeof useRoadRoute>;
  function Harness() {
    route = useRoadRoute(a, c, [b]);
    return null;
  }
  await act(async () => {
    tree = Renderer.create(<Harness />);
  });
  expect(route.status).toBe('error');
  expect(route.polyline).toBeUndefined();
  await act(async () => {
    route.retry();
  });
  expect(route.status).toBe('ready');
  expect(route.polyline).toEqual([a, b, c]);
});
it('renders actual failed/undelivered stops without reporting fake completion', async () => {
  mockTrip = {
    id: 'trip-A',
    status: 'IN_TRANSIT',
    pickup: { address: 'Actual pickup' },
    stops: [
      {
        id: 'stop-A',
        sequence: 1,
        location: { address: 'Actual drop' },
        receiver: { name: 'Receiver A' },
        status: 'UNDELIVERED',
        failureReason: 'Not available',
      },
    ],
  };
  mockLive = { trip: undefined, isLoading: false, refresh: jest.fn() };
  await act(async () => {
    tree = Renderer.create(<TripRouteDetailsScreen />);
  });
  const text = tree.root
    .findAllByType(Text)
    .map((n) => n.props.children)
    .flat()
    .join(' ');
  expect(text).toContain('Actual drop');
  expect(text).toContain('UNDELIVERED');
  expect(text).toMatch(/0\s+of\s+1/);
  expect(text).not.toContain('ALL DELIVERIES COMPLETED');
});
it('does not fall back to active trip B when viewing requested trip A', async () => {
  mockTrip = { id: 'trip-B', stops: [], pickup: { address: 'Private B' } };
  mockLive = {
    trip: undefined,
    isLoading: false,
    error: new Error('missing'),
    refresh: jest.fn(),
  };
  await act(async () => {
    tree = Renderer.create(
      <TripRouteDetailsScreen route={{ params: { tripId: 'trip-A' } }} />,
    );
  });
  expect(
    tree.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .flat()
      .join(' '),
  ).not.toContain('Private B');
});

it('edits the selected existing drop with its own receiver and index', async () => {
 const navigation = { navigate: jest.fn(), goBack: jest.fn() };
 await act(async () => { tree = Renderer.create(<MultiDropOverviewScreen navigation={navigation} />); });
 const edit = (tree.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Edit Drop 2')[0];
 expect(edit).toBeDefined();
 act(() => { (edit.props as any).onPress(); });
 expect(navigation.navigate).toHaveBeenCalledWith('SelectDropLocationScreen', { mode: 'edit', editTarget: { type: 'drop', index: 1 } });
 const text = tree.root.findAllByType(Text).map(n => n.props.children).flat().join(' ');
 expect(text).toContain('Second receiver');
});
it('confirms drop deletion and requires a replacement before continuing from an empty route', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await act(async () => { tree = Renderer.create(<MultiDropOverviewScreen />); });
  const remove = (tree.root as any).findByProps({ accessibilityLabel: 'Delete Drop 2' });
  expect((tree.root as any).findAllByProps({ accessibilityLabel: 'Delete Pickup' })).toHaveLength(0);
  act(() => remove.props.onPress());
  expect(mockRemoveDrop).not.toHaveBeenCalled();
  const actions = alert.mock.calls[0][2] as any[];
  act(() => actions.find(action => action.text === 'Remove').onPress());
  expect(mockRemoveDrop).toHaveBeenCalledWith(1);
  act(() => tree.unmount());
  mockDrops = [];
  await act(async () => { tree = Renderer.create(<MultiDropOverviewScreen />); });
  expect((tree.root as any).findByProps({ accessibilityLabel: 'Continue' }).props.disabled).toBe(true);
  alert.mockRestore();
});
