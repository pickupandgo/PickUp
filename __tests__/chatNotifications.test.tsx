import React from 'react';
import Renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { AppState, Text } from 'react-native';
import { ChatNotifications, useChatNotifications } from '../src/state/ChatNotifications';
import { fetchChatMessages } from '../src/services/chatService';
let mockTrip: any = { status: 'DRIVER_ASSIGNED', paymentBookingId: 'booking' };
jest.mock('../src/state/BookingContext', () => ({ useBooking: () => ({ trip: mockTrip }) }));
jest.mock('../src/state/SessionContext', () => ({ useSession: () => ({ authUid: 'owner' }) }));
jest.mock('../src/services/chatService', () => ({ fetchChatMessages: jest.fn() }));
let state: ReturnType<typeof useChatNotifications>;
function Probe() { state = useChatNotifications(); return <Text>{state.unread ? 'unread' : 'read'}</Text>; }
beforeEach(() => { jest.useFakeTimers(); Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' }); mockTrip = { status: 'DRIVER_ASSIGNED', paymentBookingId: 'booking' }; });
afterEach(() => { jest.useRealTimers(); jest.clearAllMocks(); });
it('shows driver unread dot/banner, opens matching booking, and clears while chat is open', async () => {
  (fetchChatMessages as jest.Mock).mockResolvedValue([{ id: 'one', sender: 'driver', status: 'sent' }]);
  const onOpen = jest.fn(); let root: ReactTestRenderer;
  await act(async () => { root = Renderer.create(<ChatNotifications onOpen={onOpen}><Probe /></ChatNotifications>); });
  expect(state!.unread).toBe(true);
  act(() => (root!.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Open driver message')[0].props.onPress());
  expect(onOpen).toHaveBeenCalledWith('booking');
  await act(async () => { state!.setOpen('booking'); });
  expect(state!.unread).toBe(false);
  act(() => root!.unmount());
});
it('ignores own/read messages and does not poll completed trips', async () => {
  (fetchChatMessages as jest.Mock).mockResolvedValue([{ id: 'own', sender: 'customer', status: 'sent' }, { id: 'seen', sender: 'driver', status: 'read' }]);
  let root: ReactTestRenderer;
  await act(async () => { root = Renderer.create(<ChatNotifications onOpen={() => {}}><Probe /></ChatNotifications>); });
  expect(state!.unread).toBe(false);
  mockTrip = { ...mockTrip, status: 'COMPLETED' };
  await act(async () => { root!.update(<ChatNotifications onOpen={() => {}}><Probe /></ChatNotifications>); });
  (fetchChatMessages as jest.Mock).mockClear();
  await act(async () => { jest.advanceTimersByTime(10000); });
  expect(fetchChatMessages).not.toHaveBeenCalled();
  act(() => root!.unmount());
});
