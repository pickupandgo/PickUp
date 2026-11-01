const mockNavigate = jest.fn();
let mockReady = false;
let mockOwner = true;
jest.mock('@react-navigation/native', () => ({ createNavigationContainerRef: () => ({ isReady: () => true, navigate: (...args: unknown[]) => mockNavigate(...args) }) }));
jest.mock('../src/services/pushRegistration', () => ({ pushSessionReady: () => mockReady, ownsPush: async () => mockOwner }));
import { queuePushOpen, flushPendingPush, clearPendingPush } from '../src/services/pushNavigation';
beforeEach(() => { clearPendingPush(); mockNavigate.mockClear(); mockReady = false; mockOwner = true; });
it('holds a cold-start tap until the account is ready and opens its exact chat', async () => {
 const bookingId = '00000000-0000-4000-8000-000000000001';
 queuePushOpen({ messageId: 'chat-one', data: { notificationType: 'NEW_CHAT_MESSAGE', bookingId } });
 expect(mockNavigate).not.toHaveBeenCalled();
 mockReady = true; await flushPendingPush();
 expect(mockNavigate).toHaveBeenCalledWith('ActiveTripStack', { screen: 'ActiveTripChatScreen', params: { bookingId } });
 queuePushOpen({ messageId: 'chat-one', data: { notificationType: 'NEW_CHAT_MESSAGE', bookingId } });
 await Promise.resolve();
 expect(mockNavigate).toHaveBeenCalledTimes(1);
});
it('drops a foreign-account tap', async () => {
 mockOwner = false;
 queuePushOpen({ messageId: 'foreign', data: { bookingId: 'anything' } });
 mockReady = true; await flushPendingPush();
 expect(mockNavigate).not.toHaveBeenCalled();
});
it('opens the inbox when no valid booking reference is supplied', async () => {
 queuePushOpen({ messageId: 'general', data: { bookingId: 'not-a-booking-uuid' } });
 mockReady = true; await flushPendingPush();
 expect(mockNavigate).toHaveBeenCalledWith('NotificationCenterScreen');
});
