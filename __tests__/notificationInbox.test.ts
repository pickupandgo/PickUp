import { NotificationInbox, type NotificationHistory, type PartnerNotification } from '../src/services/notifications/NotificationInbox';

const record = (id: string, readAt: string | null = null): PartnerNotification => ({ id, type: 'BOOKING_CANCELLED',
  title: `Backend title ${id}`, body: 'Backend message', createdAt: '2026-11-02T03:00:00Z', readAt });
function setup() {
  const history: NotificationHistory = { available: true,
    list: jest.fn(async () => ({ items: [record('a')], unreadCount: 7, nextCursor: 'next' })),
    markRead: jest.fn(async () => {}), markAllRead: jest.fn(async () => {}) };
  const inbox = new NotificationInbox(); inbox.setSession('account-a', history);
  return { inbox, history };
}
test('uses backend unread count, reconciles pages and deduplicates stable ids', async () => {
  const { inbox, history } = setup(); await inbox.refresh();
  expect(inbox.getSnapshot().items[0].title).toBe('Backend title a');
  expect(inbox.getSnapshot().unreadCount).toBe(7); // Not the one loaded row.
  jest.mocked(history.list).mockResolvedValueOnce({ items: [record('a', '2026-11-02'), record('b')], unreadCount: 6, nextCursor: null });
  await inbox.loadMore();
  expect(history.list).toHaveBeenLastCalledWith('next');
  expect(inbox.getSnapshot().items.map(item => item.id)).toEqual(['a', 'b']);
  expect(inbox.getSnapshot().unreadCount).toBe(6);
});
test('marks one and all on the backend, then re-reads authoritative records/count', async () => {
  const { inbox, history } = setup(); await inbox.refresh();
  jest.mocked(history.list).mockResolvedValue({ items: [record('a', '2026-11-02')], unreadCount: 0, nextCursor: null });
  await inbox.markRead('a'); expect(history.markRead).toHaveBeenCalledWith('a');
  expect(inbox.getSnapshot().unreadCount).toBe(0);
  await inbox.markRead(); expect(history.markAllRead).toHaveBeenCalledTimes(1);
  await inbox.markRead('untrusted-push-id'); expect(history.markRead).toHaveBeenCalledTimes(1);
});
test('missing backend is unavailable, never an empty successful inbox or zero unread', async () => {
  const inbox = new NotificationInbox(); inbox.setSession('a'); await inbox.refresh();
  expect(inbox.getSnapshot()).toMatchObject({ items: [], unreadCount: null, available: false, loading: false });
  expect(inbox.getSnapshot().error).toMatch(/history.*unavailable/);
});
test('handles empty backend and retryable error', async () => {
  const { inbox, history } = setup();
  jest.mocked(history.list).mockRejectedValueOnce(new Error('Network unavailable'));
  await inbox.refresh(); expect(inbox.getSnapshot().error).toBe('Network unavailable');
  jest.mocked(history.list).mockResolvedValueOnce({ items: [], unreadCount: 0, nextCursor: null });
  await inbox.refresh(); expect(inbox.getSnapshot()).toMatchObject({ items: [], unreadCount: 0, error: null });
});
test('logout/account switching discards late responses and clears prior account data', async () => {
  const { inbox, history } = setup();
  let finish!: (page: Awaited<ReturnType<NotificationHistory['list']>>) => void;
  jest.mocked(history.list).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const request = inbox.refresh(); inbox.setSession('account-b');
  finish({ items: [record('private-a')], unreadCount: 8, nextCursor: null }); await request;
  expect(inbox.getSnapshot().items).toEqual([]); expect(inbox.getSnapshot().unreadCount).toBeNull();
  inbox.setSession(null); await inbox.refresh(); expect(inbox.getSnapshot().error).toMatch(/Sign in/);
});
test('read failures retain unread state, including a late failure after account change', async () => {
  const { inbox, history } = setup(); await inbox.refresh();
  jest.mocked(history.markRead).mockRejectedValueOnce(new Error('Read update failed'));
  await inbox.markRead('a'); expect(inbox.getSnapshot().unreadCount).toBe(7);
  expect(inbox.getSnapshot().items[0].readAt).toBeNull(); expect(inbox.getSnapshot().updating).toBe(false);
});
test('pull-to-refresh during a read request still reconciles completion and releases read controls', async () => {
  const { inbox, history } = setup(); await inbox.refresh();
  let complete!: () => void;
  jest.mocked(history.markRead).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const read = inbox.markRead('a'); await inbox.refresh();
  expect(inbox.getSnapshot().updating).toBe(true);
  jest.mocked(history.list).mockResolvedValue({ items: [record('a', '2026-11-02')], unreadCount: 0, nextCursor: null });
  complete(); await read;
  expect(inbox.getSnapshot()).toMatchObject({ updating: false, unreadCount: 0 });
});
