import type { ActiveTrip, TripOffer } from '../../types/trip';

export interface OfferDependencies {
  uid(): string | null;
  fetch(uid: string): Promise<readonly TripOffer[]>;
  availability(uid: string, available: boolean): Promise<void>;
  accept(id: string): Promise<ActiveTrip>;
  decline(id: string): Promise<void>;
  now(): number;
}
export interface OfferSnapshot {
  offer: TripOffer | null;
  collapsed: boolean;
  busy: boolean;
  error: string | null;
}

/** One authenticated offer inbox. Push is only a refresh hint; the engine decides validity. */
export class IncomingOffers {
  private state: OfferSnapshot = { offer: null, collapsed: false, busy: false, error: null };
  private listeners = new Set<() => void>();
  private owner: string | null = null;
  private epoch = 0;
  private searching = false;
  private polling: Promise<void> | null = null;
  private action: Promise<ActiveTrip | null> | null = null;
  constructor(private readonly deps: OfferDependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(value: Partial<OfferSnapshot>) {
    this.state = { ...this.state, ...value };
    this.listeners.forEach(listener => listener());
  }
  private sameSession(uid: string, epoch: number) {
    return this.owner === uid && this.deps.uid() === uid && this.epoch === epoch;
  }
  start(uid: string) {
    if (this.owner !== uid) this.reset();
    this.owner = uid;
    this.searching = true;
  }
  stop() {
    this.searching = false;
    this.update({ offer: null, error: null, collapsed: false });
    // Screen/session cleanup is not an explicit Offline transition.
  }
  reset() {
    ++this.epoch;
    this.owner = null;
    this.searching = false;
    this.polling = null;
    this.action = null;
    this.update({ offer: null, collapsed: false, busy: false, error: null });
  }
  collapse = () => this.update({ collapsed: !this.state.collapsed });
  expire = () => {
    if (this.state.offer && this.state.offer.expiresAt <= this.deps.now() && !this.state.busy) {
      this.update({ offer: null, error: null });
    }
  };
  refresh = (): Promise<void> => {
    if (this.polling) return this.polling;
    const uid = this.owner, epoch = this.epoch;
    if (!uid || !this.searching || this.state.busy || !this.sameSession(uid, epoch)) return Promise.resolve();
    const work = (async () => {
      try {
        // Await presence before fetching. Never reassert availability during acceptance.
        await this.deps.availability(uid, true);
        if (!this.searching || !this.sameSession(uid, epoch) || this.state.busy) return;
        const offers = await this.deps.fetch(uid);
        if (!this.searching || !this.sameSession(uid, epoch) || this.state.busy) return;
        const offer = offers.find(candidate => Number.isFinite(candidate.expiresAt) && candidate.expiresAt > this.deps.now()) ?? null;
        const same = offer?.id === this.state.offer?.id;
        this.update({ offer, collapsed: same && this.state.collapsed, error: same ? this.state.error : null });
      } catch {
        if (this.sameSession(uid, epoch) && this.searching && !this.state.busy) {
          this.update({ error: 'Connection unavailable. Request will be rechecked before any action.' });
          this.expire();
        }
      }
    })();
    this.polling = work;
    work.finally(() => { if (this.polling === work) this.polling = null; });
    return work;
  };
  respond(accept: boolean): Promise<ActiveTrip | null> {
    if (this.action) return this.action;
    const offer = this.state.offer, uid = this.owner, epoch = this.epoch;
    if (!offer || !uid || !this.searching || !this.sameSession(uid, epoch)) return Promise.resolve(null);
    this.update({ busy: true, error: null });
    const work = (async () => {
      try {
        // Let a pending presence write settle before the backend can mark the driver busy.
        await this.polling;
        if (!this.searching || !this.sameSession(uid, epoch)) return null;
        const current = (await this.deps.fetch(uid)).find(candidate => candidate.id === offer.id);
        if (!this.searching || !this.sameSession(uid, epoch)) return null;
        if (!current || !Number.isFinite(current.expiresAt) || current.expiresAt <= this.deps.now()) {
          this.update({ offer: null, error: null });
          return null;
        }
        const trip = accept ? await this.deps.accept(offer.id) : (await this.deps.decline(offer.id), null);
        if (!this.sameSession(uid, epoch)) return null;
        this.update({ offer: null, error: null });
        if (trip) this.searching = false;
        return trip;
      } catch {
        if (this.sameSession(uid, epoch)) this.update({ error: 'Unable to confirm this action. Check the request and try again.' });
        return null;
      } finally {
        if (this.sameSession(uid, epoch)) {
          this.update({ busy: false });
          this.expire();
        }
      }
    })();
    this.action = work;
    work.finally(() => { if (this.action === work) this.action = null; });
    return work;
  }
}
