import { isTerminalTrip } from '../trip/tripLifecycle';
import { AppState } from 'react-native';
import { TripController } from '../trip/TripController';
import { TripService } from '../trip/TripService';
import { TrackingAdapter } from './TrackingAdapter';
import type { ActiveTrip } from '../../types/trip';
import { getCurrentDriverId, setDriverAvailability } from '../engine/dispatch';

export interface TrackingDependencies {
  configure(enabled: boolean, tripId: string | null): Promise<void>;
  recover(): Promise<ActiveTrip | null>;
  apply(trip: ActiveTrip | null): void;
  identity?(): string | null;
  subscribe(listener: (trip: ActiveTrip | null) => void): () => void;
  loadOnline?(): Promise<boolean>;
  saveOnline?(online: boolean): Promise<void>;
  availability?(online: boolean): Promise<void>;
}

/** An empty active index can mean cancellation/completion. Read the known trip to
 * learn that terminal state instead of leaving an actionable stale trip on screen.
 */
export async function recoverTrackedTrip(
  service: Pick<ReturnType<typeof TripService.getInstance>, 'getActiveTrip' | 'getTripById'>,
  cached: () => ActiveTrip | null,
): Promise<ActiveTrip | null> {
  const active = await service.getActiveTrip();
  if (active) return active;
  const previous = cached();
  if (!previous || ['completed', 'cancelled', 'expired'].includes(previous.status)) return null;
  return service.getTripById(previous.id);
}

/** One authenticated-session coordinator, independent of screen focus and dispatch. */
export class TrackingService {
  private static instance: TrackingService;
  private online = false;
  private session = false;
  private tripId: string | null = null;
  private applied = '';
  private generation = 0;
  private revision = 0;
  private recovery: Promise<void> | null = null;
  private configuring: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private foreground?: { remove(): void };
  private owner: string | null | undefined;
  private ready = false;
  private availabilityWork: Promise<void> = Promise.resolve();
  private preferenceRevision = 0;
  private onlineListeners = new Set<() => void>();
  getOnline = () => this.online;
  subscribeOnline = (listener: () => void) => { this.onlineListeners.add(listener); return () => { this.onlineListeners.delete(listener); }; };
  private publishOnline() { this.onlineListeners.forEach(listener => listener()); }

  constructor(private readonly deps: TrackingDependencies) {}

  static getInstance() {
    if (!this.instance) {
      const controller = TripController.getInstance();
      this.instance = new TrackingService({
        configure: TrackingAdapter.configure,
        recover: () => controller.loadInitialTrip(),
        apply: trip => controller.setTrip(trip),
        identity: () => controller.getSessionUid(),
        subscribe: listener => controller.subscribe(listener),
        loadOnline: TrackingAdapter.loadOnline,
        saveOnline: TrackingAdapter.saveOnline,
        availability: async online => {
          const uid = getCurrentDriverId();
          if (!uid) throw new Error('Sign in to change availability.');
          await setDriverAvailability(uid, online);
        },
      });
    }
    return this.instance;
  }

  startSession() {
    if (this.session) return;
    this.session = true;
    this.owner = this.deps.identity?.();
    this.ready = !this.deps.loadOnline;
    ++this.generation;
    const generation = this.generation;
    const preferenceRevision = this.preferenceRevision;
    if (this.deps.loadOnline) this.deps.loadOnline().then(online => {
      if (!this.session || generation !== this.generation || preferenceRevision !== this.preferenceRevision) return;
      this.online = online; this.ready = true; this.publishOnline();
      this.sync(true).catch(() => {});
      this.recover().catch(() => {});
    }).catch(() => { if (generation === this.generation) this.ready = true; });
    this.unsubscribe = this.deps.subscribe(trip => {
      if (this.deps.identity && this.deps.identity() !== this.owner) {
        this.stopSession().catch(() => {}); return;
      }
      ++this.revision;
      this.tripId = trip && !isTerminalTrip(trip) ? trip.id : null;
      this.sync().catch(() => { /* Recovery retries; native errors remain visible. */ });
    });
    this.foreground = AppState.addEventListener('change', state => {
      if (state === 'active') { this.applied = ''; this.recover().catch(() => {}); }
    });
    this.timer = setInterval(() => { this.recover().catch(() => {}); }, 15_000);
    this.recover().catch(() => {});
  }

  setOnline(online: boolean): Promise<void> {
    ++this.preferenceRevision;
    const work = this.availabilityWork.catch(() => {}).then(() => this.changeOnline(online));
    this.availabilityWork = work;
    return work;
  }
  private async changeOnline(online: boolean) {
    if (!this.session) throw new Error('Sign in to change availability.');
    const generation = this.generation;
    const before = this.online;
    await this.deps.availability?.(online);
    if (!this.session || generation !== this.generation) return;
    try {
      await this.deps.saveOnline?.(online);
      this.online = online;
      this.ready = true;
      await this.sync();
    }
    catch (error) {
      this.online = before;
      await this.deps.saveOnline?.(before).catch(() => {});
      await this.deps.availability?.(before).catch(() => {});
      throw error;
    }
    this.publishOnline();
  }

  async recover() {
    if (!this.session || this.recovery) return this.recovery;
    const generation = this.generation, revision = this.revision;
    const pending = (async () => {
      try {
        const trip = await this.deps.recover();
        if (!this.session || generation !== this.generation) return;
        if (revision === this.revision) {
          this.deps.apply(trip);
          if (!trip) this.tripId = null;
        }
        await this.sync(true);
      } catch { /* A connection failure is not evidence that a trip ended. */ }
    })();
    this.recovery = pending;
    try { await pending; } finally { if (this.recovery === pending) this.recovery = null; }
  }

  async stopSession() {
    this.session = false; this.online = false; this.tripId = null;
    ++this.generation;
    this.recovery = null;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.foreground?.remove(); this.foreground = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.sync();
    this.publishOnline();
  }

  /** Activity/React teardown detaches JS only; the user-started native session continues. */
  detachSession() {
    this.session = false; ++this.generation;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.foreground?.remove(); this.foreground = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async logout() {
    ++this.preferenceRevision;
    await this.availabilityWork.catch(() => {});
    try { await this.deps.availability?.(false); }
    finally {
      await this.deps.saveOnline?.(false);
      await this.stopSession();
    }
  }

  private sync(recoverNative = false): Promise<void> {
    if (this.session && !this.ready) return Promise.resolve();
    const enabled = this.session && (this.online || this.tripId !== null);
    const tripId = this.tripId;
    const key = `${enabled}:${tripId ?? ''}`;
    const generation = this.generation;
    const work = this.configuring.catch(() => {}).then(async () => {
      if (enabled && (generation !== this.generation || tripId !== this.tripId || !this.session)) return;
      if (key === this.applied && (!recoverNative || !enabled)) return;
      await this.deps.configure(enabled, tripId);
      this.applied = key;
    });
    this.configuring = work;
    return work;
  }
}
