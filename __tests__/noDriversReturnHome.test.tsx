import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, AppState } from 'react-native';
import { useBookingSearch } from '../src/hooks/useBookingSearch';
import { leaveFailedSearch } from '../src/services/leaveFailedSearch';
import { findDriverAndCreateRide, NoDriversAvailableError } from '../src/api/matching';
import { ApiError } from '../src/api/http';
const mockClear = jest.fn(), mockSetRide = jest.fn(), mockRecover = jest.fn();
jest.mock('../src/state/BookingContext', () => ({ useBooking: () => ({ customerId: 'test', draft: { drops: [] }, pendingInput: { quoteId: 'original', paymentMethod: 'PAY_AT_DELIVERY' }, clearActiveRide: mockClear, setRide: mockSetRide, recoverBooking: mockRecover }) }));
jest.mock('../src/services/leaveFailedSearch', () => ({ leaveFailedSearch: jest.fn() }));
jest.mock('../src/api/matching', () => ({ findDriverAndCreateRide: jest.fn(), NoDriversAvailableError: class NoDriversAvailableError extends Error {} }));
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useFocusEffect: (effect: any) => require('react').useEffect(effect, [effect]) }));
let current: ReturnType<typeof useBookingSearch>;
function Harness({ navigation }: { navigation: any }) { current = useBookingSearch(true, navigation); return null; }
const leave = leaveFailedSearch as jest.Mock;
beforeEach(() => { jest.clearAllMocks(); (findDriverAndCreateRide as jest.Mock).mockRejectedValue(new NoDriversAvailableError()); });
it('releases the confirmed search and resets Home without leaving an old search in the stack', async () => {
  leave.mockResolvedValue({ kind: 'released' }); const dispatch = jest.fn(); let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  expect(current.noDrivers).toBe(true);
  await act(async () => { await current.leave('home'); });
  expect(mockClear).toHaveBeenCalledWith(undefined);
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: { index: 0, routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }] } }));
  act(() => view.unmount());
});
it('changes vehicle in the Booking stack only after safely releasing the old search', async () => {
  leave.mockResolvedValue({ kind: 'released' }); const dispatch = jest.fn(); let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  await act(async () => { await current.leave('vehicle'); });
  expect(mockClear).toHaveBeenCalledWith({ preserveDraft: true });
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: { index: 1, routes: [{ name: 'MainTabs' }, { name: 'BookingStack', state: { index: 0, routes: [{ name: 'SelectVehicleScreen', params: { returnToReview: true } }] } }] } }));
  act(() => view.unmount());
});
it('keeps unknown/offline results and a raced assignment instead of clearing them', async () => {
  leave.mockRejectedValueOnce(new ApiError('network', 'Offline'));
  const alert = jest.spyOn(Alert, 'alert'), dispatch = jest.fn(); let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  await act(async () => { await current.leave('home'); });
  expect(current.actionError).toBeTruthy(); expect(mockClear).not.toHaveBeenCalled(); expect(dispatch).not.toHaveBeenCalled();
  const ride = { id: 'assigned', status: 'ACCEPTED' };
  leave.mockResolvedValueOnce({ kind: 'active', ride });
  await act(async () => { await current.leave('vehicle'); });
  expect(mockSetRide).toHaveBeenCalledWith(ride); expect(mockClear).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith('Driver already assigned', expect.any(String), expect.any(Array));
  act(() => view.unmount());
});
it('single-flights Back/Home/vehicle actions while release is pending', async () => {
  let resolve!: (value: any) => void;
  leave.mockImplementation(() => new Promise(done => { resolve = done; })); const dispatch = jest.fn(); let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{ getParent: () => ({ dispatch }) }} />); });
  act(() => { current.requestBack(); void current.leave('vehicle'); current.retry(); });
  expect(leave).toHaveBeenCalledTimes(1); expect(findDriverAndCreateRide).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ kind: 'released' }); });
  expect(mockClear).toHaveBeenCalledTimes(1);
  act(() => view.unmount());
});
it('retries the same request once and blocks duplicate retry taps', async () => {
  let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{}} />); });
  (findDriverAndCreateRide as jest.Mock).mockImplementationOnce(() => new Promise(() => {}));
  act(() => { current.retry(); current.retry(); });
  expect(findDriverAndCreateRide).toHaveBeenCalledTimes(2);
  expect((findDriverAndCreateRide as jest.Mock).mock.calls[1][0].quoteId).toBe('original');
  expect((findDriverAndCreateRide as jest.Mock).mock.calls[1][1].retryDispatch).toBe(true);
  expect(current.noDrivers).toBe(false);
  act(() => view.unmount());
});

it('does not repeat a dispatch retry merely because the app returns to foreground', async () => {
  let listener!: (state: string) => void;
  const stateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback: any) => { listener = callback; return { remove: jest.fn() }; });
  let view: any;
  await act(async () => { view = TestRenderer.create(<Harness navigation={{}} />); });
  await act(async () => { current.retry(); });
  expect((findDriverAndCreateRide as jest.Mock).mock.calls[1][1].retryDispatch).toBe(true);
  await act(async () => { listener('background'); });
  await act(async () => { listener('active'); });
  expect((findDriverAndCreateRide as jest.Mock).mock.calls[2][1].retryDispatch).toBe(false);
  expect(current.noDrivers).toBe(true);
  act(() => view.unmount()); stateSpy.mockRestore();
});
