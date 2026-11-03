import { TripHistoryStore } from '../src/services/trip/TripHistoryStore';
import type { TripHistorySource } from '../src/services/trip/TripHistoryService';
import type { TripHistorySnapshot } from '../src/types/tripHistory';
import { EngineApiError } from '../src/services/engine/engineClient';
import { historyTrip, uid, uuid } from '../__fixtures__/tripHistory';
const snapshot = (): TripHistorySnapshot => ({ items: [historyTrip()], counts: { all: 1, completed: 1, cancelled: 0 }, truncated: false });
function setup(tripId?: string) {
  const source: TripHistorySource = { list: jest.fn(async () => snapshot()), get: jest.fn(async () => historyTrip()), enrich: jest.fn(async () => {}) };
  const store = new TripHistoryStore(source, tripId); store.setSession(uid); store.setActive(true);
  return { source, store };
}
test('coalesces simultaneous first-page/refresh requests instead of duplicating history reads', async () => {
  const { store, source } = setup(); const first = store.refresh(); const second = store.refresh();
  expect(first).toBe(second); await first;
  expect(source.list).toHaveBeenCalledTimes(1); expect(store.getSnapshot()).toMatchObject({ ready: true, loading: false, counts: { all: 1 } });
});
test('refresh after backend completion/cancellation reconciles records and counts', async () => {
  const { store, source } = setup(); await store.refresh();
  jest.mocked(source.list).mockResolvedValueOnce({ items: [historyTrip({ status: 'CANCELLED', cancellationReason: 'Real cancellation' })], counts: { all: 1, completed: 0, cancelled: 1 }, truncated: false });
  await store.refresh(); expect(store.getSnapshot().items[0].status).toBe('CANCELLED');
  expect(store.getSnapshot().counts).toEqual({ all: 1, completed: 0, cancelled: 1 });
});
test('late requests cannot restore another account or a blurred screen', async () => {
  const { store, source } = setup(); let complete!: (result: TripHistorySnapshot) => void;
  jest.mocked(source.list).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const first = store.refresh(); await Promise.resolve(); store.setSession('other-account'); complete(snapshot()); await first;
  expect(store.getSnapshot().items).toEqual([]); expect(store.getSnapshot().counts).toBeNull();
  jest.mocked(source.list).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const second = store.refresh(); await Promise.resolve(); store.setActive(false); complete(snapshot()); await second;
  expect(store.getSnapshot().ready).toBe(false);
});
test('network failure retains verified same-account records but does not fabricate an empty success', async () => {
  const { store, source } = setup(); await store.refresh();
  jest.mocked(source.list).mockRejectedValueOnce(new Error('Offline')); await store.refresh();
  expect(store.getSnapshot()).toMatchObject({ ready: true, error: 'Offline' }); expect(store.getSnapshot().items).toHaveLength(1);
  const fresh = setup(); jest.mocked(fresh.source.list).mockRejectedValueOnce(new Error('Offline')); await fresh.store.refresh();
  expect(fresh.store.getSnapshot()).toMatchObject({ ready: false, items: [], counts: null, error: 'Offline' });
});
test('unauthorized history or financial response clears all sensitive cached data', async () => {
  const { store, source } = setup(); await store.refresh();
  jest.mocked(source.enrich).mockRejectedValueOnce(new EngineApiError('AUTH_INVALID_TOKEN', 'Expired', 401)); await store.refresh();
  expect(store.getSnapshot()).toMatchObject({ ready: false, items: [], counts: null, error: 'Please sign in again to view your trips.' });
});
test('a confirmed mutation while history is in flight queues a fresh authoritative read', async () => {
  const { store, source } = setup(); let complete!: (result: TripHistorySnapshot) => void;
  jest.mocked(source.list).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const first = store.refresh(); await Promise.resolve(); store.invalidate(); complete(snapshot()); await first;
  await Promise.resolve(); await Promise.resolve();
  expect(source.list).toHaveBeenCalledTimes(2);
});
test('refresh of a capped window preserves previously retrieved older records without claiming global counts', async () => {
  const { store, source } = setup(); await store.refresh();
  jest.mocked(source.list).mockResolvedValueOnce({ items: [historyTrip({ id: uuid(99), updatedAt: '2026-11-03T00:30:00Z' })], counts: null, truncated: true });
  await store.refresh(); expect(store.getSnapshot().items.map(item => item.id)).toEqual([uuid(99), uuid(1)]); expect(store.getSnapshot().counts).toBeNull();
});
test('detail always loads the route id through the authorized service and no list cache is trusted', async () => {
  const { store, source } = setup(uuid(1)); await store.refresh();
  expect(source.get).toHaveBeenCalledWith(uid, uuid(1)); expect(source.list).not.toHaveBeenCalled();
});
