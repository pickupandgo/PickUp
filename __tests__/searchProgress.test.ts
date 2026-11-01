import { offerProgress } from '../src/hooks/useSearchProgress';
import type { SearchObservation } from '../src/hooks/useSearchProgress';
const server = Date.parse('2026-11-01T10:00:00Z');
const observation = (): SearchObservation => ({ receivedAt: 5000, ride: { id: 'r', status: 'REQUESTED', searchStatus: 'OFFERED', offerStatus: 'REQUESTED', serverTime: new Date(server).toISOString(), offerRequestedAt: new Date(server - 10000).toISOString(), offerExpiresAt: new Date(server + 10000).toISOString() } });
it('uses server timestamps and local elapsed time rather than device wall-clock offset', () => {
  expect(offerProgress(observation(), 5000)).toEqual({ fraction: 0.5, remainingSeconds: 10 });
  expect(offerProgress(observation(), 10000)).toEqual({ fraction: 0.75, remainingSeconds: 5 });
});
it('reaches the offer boundary without changing the ride or ending the search', () => {
  const item = observation();
  expect(offerProgress(item, 15000)).toEqual({ fraction: 1, remainingSeconds: 0 });
  expect(item.ride.status).toBe('REQUESTED');
  expect(offerProgress({ ...item, ride: { ...item.ride, searchStatus: 'SEARCHING', offerStatus: 'EXPIRED' } }, 15000)).toBeUndefined();
});
it('does not invent timing for legacy, stale, invalid or already-assigned observations', () => {
  const item = observation();
  expect(offerProgress(undefined, 5000)).toBeUndefined();
  expect(offerProgress(item, 15001)).toBeUndefined();
  expect(offerProgress({ ...item, ride: { ...item.ride, serverTime: undefined } }, 5000)).toBeUndefined();
  expect(offerProgress({ ...item, ride: { ...item.ride, offerExpiresAt: item.ride.offerRequestedAt } }, 5000)).toBeUndefined();
  expect(offerProgress({ ...item, ride: { ...item.ride, status: 'ACCEPTED' } }, 5000)).toBeUndefined();
});
