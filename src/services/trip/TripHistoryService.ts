import { getAuth } from '@react-native-firebase/auth';
import { EngineApiError, getEngineClient, type EngineClient } from '../engine/engineClient';
import { getPaymentsApi } from '../payments';
import type { PaymentsApi } from '../payments/paymentsApi';
import type { EarningDto } from '../payments/earningsDto';
import type { TripHistoryRecord, TripHistorySnapshot } from '../../types/tripHistory';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UID = /^[A-Za-z0-9_-]{1,128}$/;
// Actual getDriverHistory query in raj_engine/src/trips/trips.service.ts.
export const HISTORY_WINDOW = 50;
// No earning-by-trip lookup exists. Bound enrichment rather than scan a lifetime ledger forever.
export const MAX_EARNING_LOOKUP_PAGES = 5;

function invalid(what: string): never {
  throw new EngineApiError('INVALID_RESPONSE', `Trip history returned invalid ${what}. Please retry.`, 0);
}
function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(what);
  return value as Record<string, unknown>;
}
function optionalText(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return invalid('text');
  return value;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) return invalid('trip reference');
  return value;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) return invalid('timestamp');
  return value;
}
function optionalTimestamp(value: unknown): string | null {
  return value == null ? null : timestamp(value);
}
function measurement(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return invalid('measurement');
  return value;
}
function address(value: unknown): string | null {
  return optionalText(object(value, 'location').address);
}
function status(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{1,59}$/.test(value)) return invalid('status');
  return value;
}

/** Narrow projection of TripView. Customer contacts, GPS coordinates and proof URLs are discarded. */
export function parseHistoryTrip(value: unknown, uid: string): TripHistoryRecord {
  const json = object(value, 'trip');
  if (json.driverId !== uid) throw new EngineApiError('IDENTITY_MISMATCH', 'This trip is not available to your partner account.', 403);
  const tripId = id(json.id);
  if (!Array.isArray(json.stops)) return invalid('stops');
  const stops = json.stops.map(stopValue => {
    const stop = object(stopValue, 'stop');
    if (!Number.isSafeInteger(stop.sequence) || (stop.sequence as number) < 1) return invalid('stop sequence');
    const stopStatus = status(stop.status);
    const proof = stop.deliveryProof == null ? null : object(stop.deliveryProof, 'delivery proof');
    const photoUri = proof?.type === 'PHOTO' ? optionalText(proof.uri) : null;
    // A stored URI is not an upload grant. Never fetch it or infer delivery from its presence.
    const deliveryPhoto = stopStatus === 'DELIVERED' && photoUri ? {
      availability: /^(file|content):\/\//i.test(photoUri) ? 'DEVICE_ONLY' as const : 'PREVIEW_UNAVAILABLE' as const,
      submittedAt: optionalTimestamp(proof?.submittedAt),
    } : null;
    return { id: id(stop.id), sequence: stop.sequence as number, address: address(stop.location), status: status(stop.status),
      arrivedAt: optionalTimestamp(stop.arrivedAt), deliveredAt: optionalTimestamp(stop.deliveredAt), failedAt: optionalTimestamp(stop.failedAt), deliveryPhoto };
  }).sort((a, b) => a.sequence - b.sequence);
  if (new Set(stops.map(stop => stop.sequence)).size !== stops.length || new Set(stops.map(stop => stop.id)).size !== stops.length) return invalid('duplicate stops');
  const createdAt = timestamp(json.createdAt);
  const updatedAt = timestamp(json.updatedAt);
  const timelineFields = [
    ['createdAt', 'Trip created'], ['arrivedAt', 'Arrived at pickup'], ['pickupVerifiedAt', 'Pickup verified'],
    ['startedAt', 'Trip started'], ['deliveredAt', 'Deliveries finished'], ['completionRequestedAt', 'Completion requested'],
    ['completedAt', 'Trip completed'], ['cancelledAt', 'Trip cancelled'],
  ];
  const timeline = timelineFields.flatMap(([field, label]) => {
    const at = optionalTimestamp(json[field]); return at ? [{ label, at }] : [];
  });
  for (const stop of stops) {
    if (stop.arrivedAt) timeline.push({ label: `Arrived at drop ${stop.sequence}`, at: stop.arrivedAt });
    if (stop.deliveredAt) timeline.push({ label: `Drop ${stop.sequence} delivered`, at: stop.deliveredAt });
    if (stop.failedAt) timeline.push({ label: `Drop ${stop.sequence} failed`, at: stop.failedAt });
  }
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { id: tripId, reference: optionalText(json.externalRef) ?? tripId, driverId: uid,
    paymentTripId: json.paymentTripId == null ? null : id(json.paymentTripId),
    paymentBookingId: json.paymentBookingId == null ? null : id(json.paymentBookingId),
    status: status(json.status), createdAt, updatedAt, completedAt: optionalTimestamp(json.completedAt),
    cancelledAt: optionalTimestamp(json.cancelledAt), vehicleCategory: optionalText(json.vehicleType),
    pickupAddress: address(json.pickup), stops, cancellationReason: optionalText(json.cancellationReason),
    distanceKm: measurement(json.totalDistanceKm), weightKg: measurement(json.weight), timeline, earning: null };
}

export function mergeHistory(records: readonly TripHistoryRecord[]): TripHistoryRecord[] {
  const unique = new Map<string, TripHistoryRecord>();
  for (const trip of records) {
    const old = unique.get(trip.id);
    if (!old || Date.parse(trip.updatedAt) >= Date.parse(old.updatedAt)) unique.set(trip.id, trip);
  }
  return [...unique.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}
export interface TripHistorySource {
  list(uid: string): Promise<TripHistorySnapshot>;
  get(uid: string, tripId: string): Promise<TripHistoryRecord>;
  enrich(uid: string, trips: readonly TripHistoryRecord[], current: () => boolean,
    update: (trips: readonly TripHistoryRecord[]) => void): Promise<void>;
}
export interface HistoryDependencies {
  uid(): string | null;
  engine(): EngineClient;
  payments(): Pick<PaymentsApi, 'listEarnings'> | null;
}
const live: HistoryDependencies = { uid: () => getAuth().currentUser?.uid ?? null, engine: getEngineClient, payments: getPaymentsApi };

export class BackendTripHistoryService implements TripHistorySource {
  constructor(private readonly deps: HistoryDependencies = live) {}
  private assertSession(uid: string) {
    if (!UID.test(uid) || this.deps.uid() !== uid) throw new EngineApiError('NOT_SIGNED_IN', 'Please sign in again to view your trips.', 401);
  }
  async list(uid: string): Promise<TripHistorySnapshot> {
    this.assertSession(uid);
    const json = object(await this.deps.engine().request({ method: 'GET', path: `/trips/history/driver/${encodeURIComponent(uid)}` }), 'history');
    this.assertSession(uid);
    if (json.success !== true || !Array.isArray(json.trips)) return invalid('history envelope');
    const items = mergeHistory(json.trips.map(value => parseHistoryTrip(value, uid)));
    const truncated = json.trips.length >= HISTORY_WINDOW;
    return { items, truncated, counts: truncated ? null : { all: items.length,
      completed: items.filter(trip => trip.status === 'COMPLETED').length,
      cancelled: items.filter(trip => trip.status === 'CANCELLED').length } };
  }
  async get(uid: string, tripId: string): Promise<TripHistoryRecord> {
    this.assertSession(uid);
    if (!UUID.test(tripId)) throw new EngineApiError('INVALID_TRIP_ID', 'This trip reference is invalid.', 400);
    const json = object(await this.deps.engine().request({ method: 'GET', path: `/trips/${tripId}` }), 'trip');
    this.assertSession(uid);
    if (json.success !== true) return invalid('trip envelope');
    const trip = parseHistoryTrip(json.trip, uid);
    if (trip.id !== tripId) return invalid('trip identity');
    return trip;
  }
  async enrich(uid: string, trips: readonly TripHistoryRecord[], current: () => boolean,
    update: (trips: readonly TripHistoryRecord[]) => void): Promise<void> {
    const targets = trips.filter(trip => trip.status === 'COMPLETED' && trip.paymentTripId);
    if (!targets.length) return;
    this.assertSession(uid);
    const api = this.deps.payments();
    if (!api) throw new Error('Earnings are currently unavailable.');
    const found = new Map<string, EarningDto>();
    let enriched = trips;
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    for (let pageIndex = 0; pageIndex < MAX_EARNING_LOOKUP_PAGES; pageIndex++) {
      if (!current()) return;
      this.assertSession(uid);
      const page = await api.listEarnings({ limit: 100, cursor });
      this.assertSession(uid);
      if (!current()) return;
      for (const earning of page.items) {
        const trip = targets.find(item => item.paymentTripId === earning.tripId);
        if (!trip) continue;
        if (trip.paymentBookingId && trip.paymentBookingId !== earning.bookingId) return invalid('earning booking identity');
        found.set(trip.id, earning);
      }
      const next = enriched.map(trip => {
        const actual = found.get(trip.id);
        return actual && actual !== trip.earning ? { ...trip, earning: actual } : trip;
      });
      if (next.some((trip, index) => trip !== enriched[index])) { enriched = next; update(enriched); }
      if (found.size === targets.length || page.nextCursor === null) return;
      if (seenCursors.has(page.nextCursor)) return invalid('earnings cursor');
      seenCursors.add(page.nextCursor); cursor = page.nextCursor;
    }
    throw new Error('Some earnings are unavailable in this trip view. View Earnings for your full financial history.');
  }
}

export const backendTripHistory = new BackendTripHistoryService();
