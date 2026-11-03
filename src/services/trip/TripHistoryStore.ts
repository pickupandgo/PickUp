import type { TripHistoryCounts, TripHistoryRecord, TripHistorySnapshot } from '../../types/tripHistory';
import { mergeHistory, type TripHistorySource } from './TripHistoryService';

export interface TripHistoryState {
  uid: string | null;
  items: readonly TripHistoryRecord[];
  counts: TripHistoryCounts | null;
  truncated: boolean;
  ready: boolean;
  loading: boolean;
  refreshing: boolean;
  financeLoading: boolean;
  error: string | null;
  financeError: string | null;
}
const initial = (uid: string | null): TripHistoryState => ({ uid, items: [], counts: null, truncated: false,
  ready: false, loading: false, refreshing: false, financeLoading: false, error: null, financeError: null });
export function isHistoryAuthError(error: unknown): boolean {
  const e = error as { status?: number; code?: string } | null;
  return e?.status === 401 || e?.status === 403 || e?.code === 'NOT_SIGNED_IN';
}
export function historyError(error: unknown): string {
  if (isHistoryAuthError(error)) return 'Please sign in again to view your trips.';
  if ((error as { status?: number } | null)?.status === 404) return 'Trip history is currently unavailable. Please retry later.';
  return error instanceof Error ? error.message : 'Could not load trips. Check your connection and retry.';
}

/** One mounted history/detail query; nothing is persisted to device storage. */
export class TripHistoryStore {
  private state = initial(null);
  private listeners = new Set<() => void>();
  private generation = 0;
  private active = false;
  private queued = false;
  private request: Promise<void> | null = null;
  constructor(private readonly source: TripHistorySource, private readonly tripId?: string) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(value: Partial<TripHistoryState>) {
    this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener());
  }
  setSession(uid: string | null) {
    if (uid === this.state.uid) return;
    this.generation++; this.request = null; this.queued = false;
    this.state = initial(uid); this.publish({});
  }
  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.generation++; this.request = null; this.queued = false;
      this.publish({ loading: false, refreshing: false, financeLoading: false });
    }
  }
  invalidate() {
    if (!this.active) return;
    if (this.request) this.queued = true;
    else this.refresh().catch(() => {});
  }
  refresh = (): Promise<void> => {
    if (!this.active) return Promise.resolve();
    if (this.request) return this.request;
    const uid = this.state.uid;
    if (!uid) {
      this.state = initial(null); this.publish({ error: 'Please sign in again to view your trips.' });
      return Promise.resolve();
    }
    const generation = ++this.generation;
    const current = () => this.active && generation === this.generation && uid === this.state.uid;
    this.publish({ loading: !this.state.ready, refreshing: this.state.ready, error: null, financeError: null });
    // Defer work so this.request exists even for a synchronously resolved test adapter.
    const work = Promise.resolve().then(async () => {
      try {
        const snapshot: TripHistorySnapshot = this.tripId
          ? { items: [await this.source.get(uid, this.tripId)], counts: null, truncated: false }
          : await this.source.list(uid);
        if (!current()) return;
        this.request = null;
        // Preserve previously retrieved older rows if the server's newest 50 displace them.
        // An exhaustive response replaces the old snapshot, including a genuine empty one.
        const items = snapshot.truncated ? mergeHistory([...this.state.items, ...snapshot.items]).slice(0, 250) : snapshot.items;
        this.publish({ items, counts: snapshot.counts, truncated: snapshot.truncated, ready: true,
          loading: false, refreshing: false, financeLoading: snapshot.items.some(trip => trip.status === 'COMPLETED' && trip.paymentTripId !== null) });
        if (this.queued) { this.queued = false; this.refresh().catch(() => {}); return; }
        try {
          await this.source.enrich(uid, snapshot.items, current, updated => {
            if (current()) this.publish({ items: mergeHistory([...this.state.items, ...updated]) });
          });
        } catch (error) {
          if (!current()) return;
          if (isHistoryAuthError(error)) {
            this.generation++; this.state = initial(uid); this.publish({ error: historyError(error) });
          } else this.publish({ financeError: historyError(error) });
        } finally {
          if (current()) this.publish({ financeLoading: false });
        }
      } catch (error) {
        if (!current()) return;
        if (isHistoryAuthError(error)) this.state = initial(uid);
        this.publish({ loading: false, refreshing: false, financeLoading: false, error: historyError(error) });
      } finally {
        if (current() && this.request === work) this.request = null;
      }
    });
    this.request = work;
    return work;
  };
}
