import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';
import { useBookingSearch } from '../src/hooks/useBookingSearch';
import { findDriverAndCreateRide, NoDriversAvailableError } from '../src/api/matching';
let mockScreenFocused = true;
const mockSetRide = jest.fn(), mockSetTrip = jest.fn(), mockRecover = jest.fn();
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: (effect: any) => require('react').useEffect(() => mockScreenFocused ? effect() : undefined, [effect, mockScreenFocused]) }));
jest.mock('../src/state/BookingContext', () => ({ useBooking: () => ({ customerId: 'A', draft: { drops: [] }, pendingInput: { quoteId: 'q', paymentMethod: 'PAY_AT_DELIVERY' }, setRide: mockSetRide, setTrip: mockSetTrip, recoverBooking: mockRecover }) }));
jest.mock('../src/api/matching', () => ({ findDriverAndCreateRide: jest.fn(), NoDriversAvailableError: class NoDriversAvailableError extends Error {} }));
jest.mock('../src/api/engine', () => ({ getRideTrip: jest.fn(async () => null) }));
let current: ReturnType<typeof useBookingSearch>;
function Harness({ navigation }: { navigation: any }) { current = useBookingSearch(true, navigation); return null; }
beforeEach(() => { jest.clearAllMocks(); mockScreenFocused = true; (findDriverAndCreateRide as jest.Mock).mockImplementation(() => new Promise(() => {})); });
it('confirms cancellation on Back and keeps a resumable search beneath cancellation', async () => {
  const alert = jest.spyOn(Alert, 'alert'); const dispatch = jest.fn();
  let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  act(() => current.requestBack());
  expect(alert).toHaveBeenCalledWith('Cancel Booking?', expect.any(String), expect.any(Array), expect.any(Object));
  act(() => alert.mock.calls[0][2]![1].onPress?.());
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ routes: expect.arrayContaining([expect.objectContaining({ name: 'ActiveTripStack', state: { index: 1, routes: [{ name: 'FindingDriverScreen' }, { name: 'CancellationReasonScreen', params: undefined }] } })]) }) }));
  expect((findDriverAndCreateRide as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  act(() => view.unmount());
});
it('aborts on blur and ignores assignment returned after leaving the focused search', async () => {
  let finish!: (value: any) => void;
  (findDriverAndCreateRide as jest.Mock).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const dispatch = jest.fn(); const navigation = { getParent: () => ({ dispatch }) };
  let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={navigation} />); });
  mockScreenFocused = false;
  await act(async () => { view.update(<Harness navigation={navigation} />); });
  expect((findDriverAndCreateRide as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => { finish({ ride: { id: 'old' } }); });
  expect(dispatch).not.toHaveBeenCalled(); expect(mockSetRide).not.toHaveBeenCalled();
  act(() => view.unmount());
});
it('opens assigned Trip Details without a GPS or trip read blocking it', async () => {
  (findDriverAndCreateRide as jest.Mock).mockResolvedValue({ ride: { id: 'assigned', status: 'ACCEPTED' } });
  const dispatch = jest.fn(); let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ routes: expect.arrayContaining([expect.objectContaining({ name: 'ActiveTripStack', state: { index: 0, routes: [{ name: 'DriverAssignedExpandedScreen', params: undefined }] } })]) }) }));
  act(() => view.unmount());
});
it('keeps network failures recoverable instead of claiming no drivers', async () => {
  (findDriverAndCreateRide as jest.Mock).mockRejectedValue(new Error('Offline'));
  const dispatch = jest.fn(); let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  expect(current.failure).toBeTruthy(); expect(mockRecover).toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  act(() => view.unmount());
});

it('uses the server exhausted-search result for no-driver navigation', async () => {
  (findDriverAndCreateRide as jest.Mock).mockRejectedValue(new NoDriversAvailableError());
  const dispatch = jest.fn(); let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  expect(current.failure).toBeUndefined();
  expect(mockRecover).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(current.noDrivers).toBe(true);
  act(() => view.unmount());
});
