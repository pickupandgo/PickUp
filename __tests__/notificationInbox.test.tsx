import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text } from 'react-native';
import { paymentsRequest } from '../src/api/payments';
import { useNotificationInbox } from '../src/hooks/useNotificationInbox';
import NotificationCenterScreen from '../src/screens/support/NotificationCenterScreen';
let mockUser: any = { uid: 'A' };
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../src/api/payments', () => ({ paymentsRequest: jest.fn() }));
const bookingId = '00000000-0000-4000-8000-000000000001';
const event = { id: '00000000-0000-4000-8000-000000000002', type: 'NEW_CHAT_MESSAGE', title: 'Driver message A', body: 'Hello', createdAt: '2026-10-31T10:00:00Z', readAt: null, data: { bookingId } };
let renderer: ReactTestRenderer;
beforeEach(() => { jest.clearAllMocks(); mockUser = { uid: 'A' }; });
afterEach(() => { if (renderer) act(() => renderer.unmount()); });
it('loads real inbox events and opens the exact booking chat', async () => {
 (paymentsRequest as jest.Mock).mockResolvedValueOnce({ items: [event], nextCursor: null }).mockResolvedValueOnce({ success: true });
 const navigation = { navigate: jest.fn() };
 await act(async () => { renderer = TestRenderer.create(<NotificationCenterScreen navigation={navigation} />); });
 const title = renderer.root.findAllByType(Text).find(node => node.props.children === event.title);
 expect(title).toBeDefined();
 let button: any = (title as any).parent;
 while (button && typeof button.props.onPress !== 'function') button = button.parent;
 await act(async () => { await button.props.onPress(); });
 expect(paymentsRequest).toHaveBeenCalledWith(`/v1/notifications/inbox/${event.id}/read`, expect.objectContaining({ method: 'POST' }));
 expect(navigation.navigate).toHaveBeenCalledWith('ActiveTripStack', { screen: 'ActiveTripChatScreen', params: { bookingId } });
});
it('distinguishes a failed request from an empty successful inbox', async () => {
 (paymentsRequest as jest.Mock).mockRejectedValue(new Error('offline'));
 await act(async () => { renderer = TestRenderer.create(<NotificationCenterScreen />); });
 const text = renderer.root.findAllByType(Text).map(node => node.props.children).flat().join(' ');
 expect(text).not.toContain('No notifications in this category.'); expect(text).toContain('Notification history is not available yet.');
});
it('retains unread state if the server does not acknowledge the read', async () => {
 (paymentsRequest as jest.Mock).mockResolvedValueOnce({ items: [event], nextCursor: null }).mockRejectedValueOnce(new Error('offline'));
 let state!: ReturnType<typeof useNotificationInbox>;
 function Capture() { state = useNotificationInbox(true); return null; }
 await act(async () => { renderer = TestRenderer.create(<Capture />); });
 await act(async () => { await expect(state.markRead(event.id)).rejects.toThrow('offline'); });
 expect(state.items[0].readAt).toBeNull();
});
it('ignores a delayed old-account response after the account changes', async () => {
 let finish!: (value: any) => void;
 (paymentsRequest as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ items: [], nextCursor: null });
 let state!: ReturnType<typeof useNotificationInbox>;
 function Capture() { state = useNotificationInbox(true); return null; }
 await act(async () => { renderer = TestRenderer.create(<Capture />); });
 mockUser = { uid: 'B' };
 await act(async () => { renderer.update(<Capture />); });
 await act(async () => { finish({ items: [event], nextCursor: null }); });
 expect(state.items).toEqual([]);
});

it('marks older pages too and updates only server-acknowledged reads', async () => {
 const older = { ...event, id: 'older-event' };
 (paymentsRequest as jest.Mock).mockResolvedValueOnce({ items: [event], nextCursor: 'page-two' })
  .mockResolvedValueOnce({ items: [older], nextCursor: null })
  .mockResolvedValue({ success: true });
 let state!: ReturnType<typeof useNotificationInbox>;
 function Capture() { state = useNotificationInbox(true); return null; }
 await act(async () => { renderer = TestRenderer.create(<Capture />); });
 await act(async () => { await state.markAllRead(); });
 expect(paymentsRequest).toHaveBeenCalledWith('/v1/notifications/inbox?cursor=page-two', expect.anything());
 expect(paymentsRequest).toHaveBeenCalledWith('/v1/notifications/inbox/older-event/read', expect.objectContaining({ method: 'POST' }));
 expect(state.items[0].readAt).not.toBeNull();
});
it('preserves unread cards when mark-all fails', async () => {
 (paymentsRequest as jest.Mock).mockResolvedValueOnce({ items: [event], nextCursor: null }).mockRejectedValueOnce(new Error('offline'));
 let state!: ReturnType<typeof useNotificationInbox>;
 function Capture() { state = useNotificationInbox(true); return null; }
 await act(async () => { renderer = TestRenderer.create(<Capture />); });
 await act(async () => { await expect(state.markAllRead()).rejects.toThrow('offline'); });
 expect(state.items[0].readAt).toBeNull();
});
