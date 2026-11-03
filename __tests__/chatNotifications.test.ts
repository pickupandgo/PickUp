import { ChatNotifications } from '../src/services/notifications/ChatNotifications';
import {
  NotificationError,
  type ChatSummary,
} from '../src/services/notifications/NotificationApi';
const trip = {
  id: 'engine-trip',
  paymentTripId: '00000000-0000-4000-8000-000000000001',
  status: 'DRIVER_ASSIGNED',
};
const bookingId = '00000000-0000-4000-8000-000000000002';
const summary = (ids: string[]): ChatSummary => ({
  bookingId,
  unreadCount: ids.length,
  unreadIds: ids,
});
function setup() {
  const load = jest.fn().mockResolvedValue(summary(['m1'])),
    notify = jest.fn(),
    clear = jest.fn();
  const notices = new ChatNotifications({ load, notify, clear });
  notices.setSession('driver-a');
  notices.setTrip(trip);
  notices.setAllowed(true);
  return { notices, load, notify, clear };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('foreground fallback finds real unread messages, deduplicates and clears only on a fresh read result', async () => {
  const { notices, load, notify } = setup();
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  expect(notices.getSnapshot()).toMatchObject({ bookingId, unreadCount: 1 });
  expect(notify).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(15000);
  expect(notify).toHaveBeenCalledTimes(1);
  load.mockResolvedValueOnce(summary(['m1', 'm2']));
  await notices.refresh();
  expect(notify).toHaveBeenCalledTimes(2);
  load.mockResolvedValueOnce(summary([]));
  await notices.refreshAfterRead();
  expect(notices.getSnapshot().unreadCount).toBe(0);
  notices.setForeground(false);
});
test('suppresses banners and fallback polling while the same conversation is visible', async () => {
  const { notices, load, notify } = setup();
  notices.setViewing({
    uid: 'driver-a',
    ref: { kind: 'TRIP', id: trip.paymentTripId },
  });
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  expect(notify).not.toHaveBeenCalled();
  expect(notices.getSnapshot().unreadCount).toBe(1);
  await jest.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(1);
  load.mockResolvedValueOnce(summary([]));
  await notices.refreshAfterRead();
  expect(notices.getSnapshot().unreadCount).toBe(0);
  notices.setForeground(false);
});
test('reconciles push invalidations without duplicate banners and coalesces concurrent requests', async () => {
  const { notices, load, notify } = setup();
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  let finish!: (s: ChatSummary) => void;
  load.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const a = notices.refresh(),
    b = notices.refresh();
  await jest.advanceTimersByTimeAsync(0);
  finish(summary(['m1']));
  await Promise.all([a, b]);
  await jest.advanceTimersByTimeAsync(0);
  expect(notify).toHaveBeenCalledTimes(1);
  notices.setForeground(false);
});
test('pauses in background and refuses late previous-account results', async () => {
  const { notices, load, notify } = setup();
  let finish!: (s: ChatSummary) => void;
  load.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  notices.setSession(null);
  finish(summary(['private-a']));
  await jest.advanceTimersByTimeAsync(0);
  expect(notify).not.toHaveBeenCalled();
  expect(notices.getSnapshot().unreadCount).toBeNull();
  notices.setForeground(false);
  await jest.advanceTimersByTimeAsync(120000);
  expect(load).toHaveBeenCalledTimes(1);
});
test.each([403, 410])(
  'clears unread state and stops polling rejected conversations (%s)',
  async status => {
    const { notices, load, notify } = setup();
    load.mockRejectedValueOnce(
      new NotificationError('Closed or unauthorized', status),
    );
    notices.setForeground(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(notices.getSnapshot().unreadCount).toBeNull();
    expect(notify).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(120000);
    expect(load).toHaveBeenCalledTimes(1);
    notices.setForeground(false);
  },
);
test('bounds outage retries and immediately clears indicators on trip completion', async () => {
  const { notices, load } = setup();
  load.mockRejectedValue(new Error('offline'));
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  await jest.advanceTimersByTimeAsync(29999);
  expect(load).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(load).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(3);
  notices.setTrip({ ...trip, status: 'COMPLETED' });
  expect(notices.getSnapshot().backendTripId).toBeNull();
  await jest.advanceTimersByTimeAsync(120000);
  expect(load).toHaveBeenCalledTimes(3);
});
test('read synchronization waits for a snapshot started after the read event', async () => {
  const { notices, load } = setup();
  let finish!: (s: ChatSummary) => void;
  load
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(summary([]));
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  const after = notices.refreshAfterRead();
  finish(summary(['m1']));
  await expect(after).resolves.toMatchObject({ unreadCount: 0 });
  expect(load).toHaveBeenCalledTimes(2);
  notices.setForeground(false);
});

test('reauthorizes once on foreground recovery after a rejected session, without a background retry loop', async () => {
  const { notices, load } = setup();
  load.mockRejectedValueOnce(new NotificationError('Sign in again', 401));
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  notices.setForeground(false);
  await jest.advanceTimersByTimeAsync(60000);
  expect(load).toHaveBeenCalledTimes(1);
  notices.setForeground(true);
  await jest.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  expect(notices.getSnapshot().unreadCount).toBe(1);
  notices.setForeground(false);
});
