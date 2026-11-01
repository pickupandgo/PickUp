import { AppState } from 'react-native';
import { TripController } from '../trip/TripController';
import { TripService } from '../trip/TripService';
import { TrackingAdapter } from './TrackingAdapter';
import type { ActiveTrip } from '../../types/trip';

export interface TrackingDependencies {
  configure(enabled: boolean, tripId: string | null): Promise<void>;
  recover(): Promise<ActiveTrip | null>;
  apply(trip: ActiveTrip): void;
  subscribe(listener: (trip: ActiveTrip | null) => void): () => void;
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

  constructor(private readonly deps: TrackingDependencies) {}

  static getInstance() {
    if (!this.instance) {
      const controller = TripController.getInstance();
      this.instance = new TrackingService({
        configure: TrackingAdapter.configure,
        recover: () => TripService.getInstance().getActiveTrip(),
        apply: trip => controller.setTrip(trip),
        subscribe: listener => controller.subscribe(listener),
      });
    }
    return this.instance;
  }

  startSession() {
    if (this.session) return;
    this.session = true;
    ++this.generation;
    this.unsubscribe = this.deps.subscribe(trip => {
      ++this.revision;
      this.tripId = trip && !['COMPLETED', 'CANCELLED', 'DELIVERED'].includes(trip.engineStatus ?? '') &&
        !['completed', 'cancelled', 'expired'].includes(trip.status) ? trip.id : null;
      this.sync().catch(() => { /* Recovery retries; native errors remain visible. */ });
    });
    this.foreground = AppState.addEventListener('change', state => {
      if (state === 'active') { this.applied = ''; this.recover().catch(() => {}); }
    });
    this.timer = setInterval(() => { this.recover().catch(() => {}); }, 15_000);
    this.recover().catch(() => {});
  }

  async setOnline(online: boolean) {
    this.online = online;
    await this.sync();
  }

  async recover() {
    if (!this.session || this.recovery) return this.recovery;
    const generation = this.generation, revision = this.revision;
    this.recovery = (async () => {
      try {
        const trip = await this.deps.recover();
        if (!this.session || generation !== this.generation || revision !== this.revision) return;
        if (trip) this.deps.apply(trip);
        else this.tripId = null; // Only an authoritative empty response ends recovery.
        await this.sync(true); // Probe/recover a stopped native service without adding a publisher.
      } catch { /* A connection failure is not evidence that a trip ended. */ }
      finally { this.recovery = null; }
    })();
    return this.recovery;
  }

  async stopSession() {
    this.session = false; this.online = false; this.tripId = null;
    ++this.generation;
    this.unsubscribe?.(); this.unsubscribe = undefined;
    this.foreground?.remove(); this.foreground = undefined;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.sync();
  }

  private sync(recoverNative = false): Promise<void> {
    const enabled = this.session && (this.online || this.tripId !== null);
    const tripId = this.tripId;
    const key = `${enabled}:${tripId ?? ''}`;
    const work = this.configuring.catch(() => {}).then(async () => {
      if (key === this.applied && (!recoverNative || !enabled)) return;
      await this.deps.configure(enabled, tripId);
      this.applied = key;
    });
    this.configuring = work;
    return work;
  }
}
