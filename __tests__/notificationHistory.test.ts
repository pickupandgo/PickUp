import { createNotificationHistory } from '../src/services/notifications/NotificationHistory';
import { createChatSummaryRequest } from '../src/services/notifications/NotificationApi';
jest.mock('../src/config/env', () => ({
  env: {
    PAYMENTS_API_BASE_URL: 'https://backend.test',
    REQUEST_TIMEOUT_MS: 15000,
  },
}));
const id = '00000000-0000-4000-8000-000000000001',
  booking = '00000000-0000-4000-8000-000000000002',
  trip = '00000000-0000-4000-8000-000000000003';
const identity = {
  uid: 'driver-a',
  getIdToken: jest.fn(async () => 'test-only-token'),
};
const record = {
  id,
  type: 'NEW_CHAT_MESSAGE',
  title: 'Old sender name',
  body: 'private legacy message',
  data: { bookingId: booking, tripId: trip },
  createdAt: '2026-11-02T10:00:00Z',
  readAt: null,
};
const response = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
afterEach(() => jest.restoreAllMocks());
test('uses deployed inbox/read routes and sanitizes private chat previews', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ items: [record], nextCursor: null }))
    .mockResolvedValueOnce(response({ success: true }));
  const history = createNotificationHistory(identity, () => true);
  const page = await history.list();
  expect(page.unreadCount).toBe(1);
  expect(page.items[0]).toMatchObject({
    bookingId: booking,
    backendTripId: trip,
    body: 'You have a new message from your customer.',
  });
  expect(JSON.stringify(page)).not.toContain('private legacy message');
  await history.markRead(id);
  expect(jest.mocked(fetch).mock.calls.map(call => call[0])).toEqual([
    'https://backend.test/v1/notifications/inbox',
    `https://backend.test/v1/notifications/inbox/${id}/read`,
  ]);
});
test('does not invent a global unread count when only one of several pages is loaded', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue(response({ items: [record], nextCursor: id }));
  expect(
    (await createNotificationHistory(identity, () => true).list()).unreadCount,
  ).toBeNull();
});
test('implements bounded mark-all through actual individual read endpoints', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(response({ items: [record], nextCursor: null }))
    .mockResolvedValueOnce(response({ success: true }));
  await createNotificationHistory(identity, () => true).markAllRead();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(jest.mocked(fetch).mock.calls[1][0]).toBe(
    `https://backend.test/v1/notifications/inbox/${id}/read`,
  );
});
test('rejects unauthorized/closed metadata and retains no private message bodies', async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValueOnce(
      response([
        {
          id,
          bookingId: booking,
          senderRole: 'CUSTOMER',
          status: 'sent',
          readAt: null,
          text: 'private',
        },
      ]),
    )
    .mockResolvedValueOnce(response({}, 410))
    .mockResolvedValueOnce(response({}, 403));
  const load = createChatSummaryRequest(identity, () => true);
  expect(await load(trip)).toEqual({
    bookingId: booking,
    unreadCount: 1,
    unreadIds: [id],
  });
  await expect(load(trip)).rejects.toMatchObject({ status: 410 });
  await expect(load(trip)).rejects.toMatchObject({ status: 403 });
});
test('rejects mixed conversations and stale account responses', async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(
    response([
      { id, bookingId: booking, senderRole: 'CUSTOMER', status: 'read' },
      { id: trip, bookingId: id, senderRole: 'CUSTOMER', status: 'sent' },
    ]),
  );
  await expect(
    createChatSummaryRequest(identity, () => true)(trip),
  ).rejects.toThrow('references do not match');
  await expect(
    createNotificationHistory(identity, () => false).list(),
  ).rejects.toThrow('session changed');
});

test('bounds stalled Firebase token acquisition without sending an unauthenticated request', async () => {
  jest.useFakeTimers();
  globalThis.fetch = jest.fn();
  try {
    const history = createNotificationHistory(
      { uid: 'driver-a', getIdToken: () => new Promise(() => {}) },
      () => true,
    );
    const pending = history.list();
    jest.advanceTimersByTime(15001);
    await expect(pending).rejects.toThrow('interrupted');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});
