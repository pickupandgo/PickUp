import { BackendTripHistoryService, parseHistoryTrip, MAX_EARNING_LOOKUP_PAGES, type HistoryDependencies } from '../src/services/trip/TripHistoryService';
import { EngineApiError } from '../src/services/engine/engineClient';
import { parseEarning } from '../src/services/payments/earningsDto';
import { historyDate, historyEarningLabel, historyMoney, historyStatus } from '../src/services/trip/tripHistoryPresentation';
import { engineTrip, earning, historyTrip, uid, uuid } from '../__fixtures__/tripHistory';
function setup() {
  const request = jest.fn(async () => ({ success: true, trips: [engineTrip()], trip: engineTrip() }));
  const listEarnings = jest.fn(async (_params?: unknown) => ({ items: [earning()], nextCursor: null as string | null }));
  const deps: HistoryDependencies = { uid: () => uid, engine: () => ({ request }), payments: () => ({ listEarnings }) };
  return { source: new BackendTripHistoryService(deps), deps, request, listEarnings };
}
test('actual ordered drop timestamps feed delivery rows and distinct chronological timeline events', () => {
  const trip = parseHistoryTrip(engineTrip({ stops: [
    { id: uuid(5), sequence: 2, location: { address: 'Second drop' }, status: 'FAILED', failedAt: '2026-11-02T00:25:00Z' },
    { id: uuid(6), sequence: 1, location: { address: 'First drop' }, status: 'DELIVERED', arrivedAt: '2026-11-02T00:10:00Z', deliveredAt: '2026-11-02T00:15:00Z' },
  ] }), uid);
  expect(trip.stops[0]).toMatchObject({ sequence: 1, deliveredAt: '2026-11-02T00:15:00Z' });
  expect(trip.timeline.filter(event => /drop/i.test(event.label)).map(event => event.label)).toEqual(['Arrived at drop 1', 'Drop 1 delivered', 'Drop 2 failed']);
  expect(trip.timeline.map(event => Date.parse(event.at))).toEqual(trip.timeline.map(event => Date.parse(event.at)).sort((a, b) => a - b));
  expect(() => parseHistoryTrip(engineTrip({ stops: [{ id: uuid(5), sequence: 1, location: {}, status: 'DELIVERED', deliveredAt: 'bad-date' }] }), uid)).toThrow('timestamp');
});
test('calls the actual authenticated engine history route and projects only needed historical fields', async () => {
  const { source, request } = setup(); const snapshot = await source.list(uid);
  expect(request).toHaveBeenCalledWith({ method: 'GET', path: `/trips/history/driver/${uid}` });
  expect(snapshot.counts).toEqual({ all: 1, completed: 1, cancelled: 0 });
  expect(snapshot.items[0]).toMatchObject({ reference: 'actual-booking-reference', vehicleCategory: 'MINI_TRUCK', pickupAddress: 'Backend pickup address', earning: null });
  expect(snapshot.items[0].stops.map(stop => stop.address)).toEqual(['Backend first drop', 'Backend second drop']);
  expect(JSON.stringify(snapshot)).not.toMatch(/private-test-contact|receiver|99999/);
  expect(historyDate(snapshot.items[0])).toMatch(/2 Nov 2026.*6:00/i);
});
test('empty backend is genuinely empty; duplicate ids do not duplicate cards or counts', async () => {
  const { source, request } = setup(); request.mockResolvedValueOnce({ success: true, trips: [], trip: engineTrip() });
  expect((await source.list(uid)).counts).toEqual({ all: 0, completed: 0, cancelled: 0 });
  request.mockResolvedValueOnce({ success: true, trips: [engineTrip(), engineTrip()], trip: engineTrip() });
  expect((await source.list(uid)).items).toHaveLength(1);
});
test('50-row server window never becomes an invented global count or pagination cursor', async () => {
  const { source, request } = setup();
  request.mockResolvedValueOnce({ success: true, trips: Array.from({ length: 50 }, (_, n) => engineTrip({ id: uuid(100 + n) })), trip: engineTrip() });
  expect(await source.list(uid)).toMatchObject({ truncated: true, counts: null });
});
test('completion/cancellation come only from exact engine status, never payment or expiry', async () => {
  const { source, request } = setup();
  request.mockResolvedValueOnce({ success: true, trips: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'REJECTED', 'DELIVERED'].map((status, n) => engineTrip({ id: uuid(100 + n), status })), trip: engineTrip() });
  expect((await source.list(uid)).counts).toEqual({ all: 5, completed: 1, cancelled: 1 });
  expect(historyStatus('UNRECOGNISED').variant).toBe('expired');
  expect(historyStatus('DELIVERED').label).not.toBe('Completed');
});
test('authorizes detail by server request and rejects customer-only/other-driver records', async () => {
  const { source, request, deps } = setup();
  await source.get(uid, uuid(1)); expect(request).toHaveBeenLastCalledWith({ method: 'GET', path: `/trips/${uuid(1)}` });
  request.mockResolvedValueOnce({ success: true, trips: [], trip: engineTrip({ driverId: 'other-partner' }) });
  await expect(source.get(uid, uuid(1))).rejects.toMatchObject({ status: 403 });
  await expect(source.list('other-partner')).rejects.toMatchObject({ status: 401 });
  deps.uid = () => null; await expect(source.list(uid)).rejects.toMatchObject({ status: 401 });
});
test('expired session and API failures propagate, never falling back to mock history', async () => {
  const { source, request } = setup(); request.mockRejectedValueOnce(new EngineApiError('AUTH_INVALID_TOKEN', 'Expired', 401));
  await expect(source.list(uid)).rejects.toMatchObject({ status: 401 });
  request.mockRejectedValueOnce(new Error('Network unavailable')); await expect(source.list(uid)).rejects.toThrow('Network unavailable');
  expect(() => parseHistoryTrip(engineTrip({ createdAt: undefined }), uid)).toThrow(/timestamp/);
});
test('a session change while a response is in flight prevents accepting it', async () => {
  const { source, request, deps } = setup();
  request.mockImplementationOnce(async () => { deps.uid = () => 'new-account'; return { success: true, trips: [engineTrip()], trip: engineTrip() }; });
  await expect(source.list(uid)).rejects.toMatchObject({ status: 401 });
});
test('earnings pagination joins payment trip AND booking identities; uses net record, never gross fare', async () => {
  const { source, listEarnings } = setup();
  listEarnings.mockResolvedValueOnce({ items: [earning({ tripId: uuid(999) })], nextCursor: uuid(90) });
  const update = jest.fn(); await source.enrich(uid, [historyTrip()], () => true, update);
  expect(listEarnings.mock.calls).toEqual([[{ limit: 100, cursor: undefined }], [{ limit: 100, cursor: uuid(90) }]]);
  expect(update.mock.calls.at(-1)![0][0].earning.netAmountPaise).toBe(170000);
  expect(historyMoney(update.mock.calls.at(-1)![0][0].earning.netAmountPaise)).toBe('₹1,700');
});
test('missing financials and cancelled charges remain unavailable, genuine zero remains zero', async () => {
  const { source, listEarnings } = setup(); listEarnings.mockResolvedValueOnce({ items: [], nextCursor: null });
  const update = jest.fn(); await source.enrich(uid, [historyTrip()], () => true, update);
  expect(update).not.toHaveBeenCalled(); expect(historyTrip().earning).toBeNull();
  listEarnings.mockClear(); await source.enrich(uid, [historyTrip({ status: 'CANCELLED' })], () => true, update);
  expect(listEarnings).not.toHaveBeenCalled();
  expect(historyMoney(earning({ netAmountPaise: 0 }).netAmountPaise)).toBe('₹0');
});
test('mismatched earning identity and repeated cursors fail rather than show another financial record', async () => {
  const { source, listEarnings } = setup(); listEarnings.mockResolvedValueOnce({ items: [earning({ bookingId: uuid(999) })], nextCursor: null });
  await expect(source.enrich(uid, [historyTrip()], () => true, jest.fn())).rejects.toThrow(/booking identity/);
  listEarnings.mockResolvedValue({ items: [], nextCursor: uuid(90) });
  await expect(source.enrich(uid, [historyTrip()], () => true, jest.fn())).rejects.toThrow(/cursor/);
});
test('financial lookup is bounded and stops when history loses focus', async () => {
  const { source, listEarnings } = setup(); let page = 0;
  listEarnings.mockImplementation(async () => ({ items: [], nextCursor: uuid(90 + page++) }));
  await expect(source.enrich(uid, [historyTrip()], () => true, jest.fn())).rejects.toThrow(/full financial history/);
  expect(listEarnings).toHaveBeenCalledTimes(MAX_EARNING_LOOKUP_PAGES);
  listEarnings.mockClear(); await source.enrich(uid, [historyTrip()], () => false, jest.fn()); expect(listEarnings).not.toHaveBeenCalled();
});
test('actual mixed cash/online earning DTO is accepted and never labelled paid to wallet', () => {
  const mixed = parseEarning(earning({ settlement: 'MIXED' }));
  expect(historyEarningLabel(mixed)).toBe('Cash + online · Payable');
});
