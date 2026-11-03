import {
  PushSession,
  type PushDependencies,
  type PushEnvelope,
} from '../src/services/notifications/PushSession';
const user = (uid: string) => ({
  uid,
  getIdToken: jest.fn(async () => `bearer-${uid}`),
});
const message = (
  id = 'event-1',
  recipientId = 'recipient-a',
): PushEnvelope => ({
  messageId: id,
  data: { notificationType: 'BOOKING_CANCELLED', role: 'DRIVER', recipientId },
});
function setup() {
  const register = jest.fn(async () => ({ userId: 'recipient-a' }));
  const unregister = jest.fn(async () => ({}));
  const deps: PushDependencies = {
    getToken: jest.fn(async () => 'installation-1'),
    deleteToken: jest.fn(async () => {}),
    backend: jest.fn(() => ({ register, unregister })),
    resetInbox: jest.fn(),
    refreshInbox: jest.fn(async () => {}),
    showBanner: jest.fn(),
    openInbox: jest.fn(),
    clearBanner: jest.fn(),
    reportError: jest.fn(),
  };
  return { deps, register, unregister, session: new PushSession(deps) };
}
test('registers/restores session, avoids duplicate registration and handles token refresh', async () => {
  const { session, register, unregister } = setup();
  await session.setUser(user('a'));
  await session.setUser(user('a'));
  await session.register();
  expect(register.mock.calls).toEqual([['installation-1', 'en']]);
  await session.register('refreshed-token');
  expect(unregister).toHaveBeenCalledWith('installation-1');
  expect(register).toHaveBeenLastCalledWith('refreshed-token', 'en');
});
test('foreground push invalidates history and shows one banner without automatic navigation', async () => {
  const { session, deps } = setup();
  await session.setUser(user('a'));
  jest.mocked(deps.refreshInbox).mockClear();
  session.receive(message());
  session.receive(message());
  expect(deps.showBanner).toHaveBeenCalledTimes(1);
  expect(deps.refreshInbox).toHaveBeenCalledTimes(1);
  expect(deps.openInbox).not.toHaveBeenCalled();
  session.tap(message());
  session.tap(message());
  expect(deps.openInbox).toHaveBeenCalledTimes(1);
});

test('chat pushes invalidate verified chat metadata rather than duplicating banners over the open conversation', async () => {
  const { session, deps } = setup();
  deps.chatChanged = jest.fn();
  await session.setUser(user('a'));
  const chat = {
    messageId: 'chat-invalidation',
    data: {
      role: 'DRIVER',
      recipientId: 'recipient-a',
      notificationType: 'NEW_CHAT_MESSAGE',
      bookingId: '00000000-0000-4000-8000-000000000001',
    },
  };
  session.receive(chat);
  session.receive(chat);
  expect(deps.chatChanged).toHaveBeenCalledTimes(1);
  expect(deps.showBanner).not.toHaveBeenCalled();
});

test('chat taps open only a validated booking for the authenticated recipient and deduplicate events', async () => {
  const { session, deps } = setup();
  deps.openChat = jest.fn();
  await session.setUser(user('a'));
  const bookingId = '00000000-0000-4000-8000-000000000001';
  const chat = {
    messageId: 'chat-1',
    data: {
      role: 'DRIVER',
      recipientId: 'recipient-a',
      notificationType: 'NEW_CHAT_MESSAGE',
      bookingId,
    },
  };
  session.tap({ ...chat, data: { ...chat.data, recipientId: 'recipient-b' } });
  expect(deps.openChat).not.toHaveBeenCalled();
  session.tap(chat);
  session.tap(chat);
  expect(deps.openChat).toHaveBeenCalledTimes(1);
  expect(deps.openChat).toHaveBeenCalledWith(bookingId);
  session.tap({
    ...chat,
    messageId: 'chat-2',
    data: { ...chat.data, bookingId: 'untrusted-placeholder' },
  });
  expect(deps.openChat).toHaveBeenCalledTimes(1);
});
test('rejects another account, customer role, missing recipient and messages without dedup keys', async () => {
  const { session, deps } = setup();
  await session.setUser(user('a'));
  session.receive(message('x', 'recipient-b'));
  session.tap(message('y', 'recipient-b'));
  session.receive({
    messageId: 'customer',
    data: { role: 'CUSTOMER', recipientId: 'recipient-a' },
  });
  session.receive({ data: { role: 'DRIVER', recipientId: 'recipient-a' } });
  expect(deps.showBanner).not.toHaveBeenCalled();
  expect(deps.openInbox).not.toHaveBeenCalled();
});
test('queues cold-start tap until authenticated backend identity is known; keeps only validated notification id', async () => {
  const { session, deps } = setup();
  session.tap({
    ...message(),
    data: {
      ...message().data,
      notificationId: 'record-1',
      tripId: 'untrusted-trip',
    },
  });
  expect(deps.openInbox).not.toHaveBeenCalled();
  await session.setUser(user('a'));
  expect(deps.openInbox).toHaveBeenCalledWith('record-1');
});
test('logout deactivates association before invalidating the FCM token and clears all UI state', async () => {
  const { session, deps, unregister } = setup();
  await session.setUser(user('a'));
  await session.logout();
  expect(unregister).toHaveBeenCalledWith('installation-1');
  expect(deps.deleteToken).toHaveBeenCalled();
  expect(unregister.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(deps.deleteToken).mock.invocationCallOrder[0],
  );
  expect(deps.resetInbox).toHaveBeenLastCalledWith(null);
  session.receive(message());
  expect(deps.showBanner).not.toHaveBeenCalled();
});
test('invalidates FCM token if backend cleanup fails, then account switching cannot reuse prior ownership', async () => {
  const { session, deps, register, unregister } = setup();
  await session.setUser(user('a'));
  unregister.mockRejectedValueOnce(new Error('Offline'));
  jest.mocked(deps.getToken).mockResolvedValueOnce('replacement-installation');
  register.mockResolvedValueOnce({ userId: 'recipient-b' });
  await session.setUser(user('b'));
  expect(deps.deleteToken).toHaveBeenCalled();
  expect(register).toHaveBeenLastCalledWith('replacement-installation', 'en');
  session.receive(message());
  expect(deps.showBanner).not.toHaveBeenCalled();
});
test('registration failure is visible and retried; a late registration cannot open previous-session tap', async () => {
  const { session, deps, register } = setup();
  register.mockRejectedValueOnce(new Error('503'));
  await session.setUser(user('a'));
  expect(deps.reportError).toHaveBeenLastCalledWith(
    expect.stringContaining('unavailable'),
  );
  await session.register();
  expect(register).toHaveBeenCalledTimes(2);
  expect(deps.reportError).toHaveBeenLastCalledWith(null);
});

test('restores verified recipient ownership and queued taps after a rapid same-account session restoration', async () => {
  const { session, deps, register } = setup();
  await session.setUser(user('a'));
  const signedOut = session.setUser(null);
  session.tap(message('restored-tap'));
  const restored = session.setUser(user('a'));
  await Promise.all([signedOut, restored]);
  expect(register).toHaveBeenCalledTimes(1);
  expect(deps.openInbox).toHaveBeenCalledTimes(1);
  session.receive(message('restored-event'));
  expect(deps.showBanner).toHaveBeenCalledTimes(1);
});

test('deduplicates repeated transport deliveries by persisted notification ID and preserves distinct events', async () => {
  const { session, deps } = setup(); await session.setUser(user('a'));
  const first = message('transport-a'); first.data!.notificationId = 'event-a';
  session.receive(first); session.receive({ ...first, messageId: 'transport-b' });
  expect(deps.showBanner).toHaveBeenCalledTimes(1);
  session.receive({ ...first, messageId: 'transport-c', data: { ...first.data, notificationId: 'event-b' } });
  expect(deps.showBanner).toHaveBeenCalledTimes(2);
});
test('routes non-chat trip taps through the authenticated event resolver', async () => {
  const { session, deps } = setup(); deps.openEvent = jest.fn(); await session.setUser(user('a'));
  const event = message('trip-event'); event.data!.tripId = 'backend-trip';
  session.tap(event); expect(deps.openEvent).toHaveBeenCalledWith(event); expect(deps.openInbox).not.toHaveBeenCalled();
});
