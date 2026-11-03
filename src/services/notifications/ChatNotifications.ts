import { NotificationError, type ChatSummary } from './NotificationApi';
import type { NotificationConversation } from './ChatNotificationSignals';

export interface NotificationTrip {
  id: string;
  paymentTripId?: string | null;
  status?: string;
  engineStatus?: string;
}
export interface ChatNoticeState {
  backendTripId: string | null;
  bookingId: string | null;
  unreadCount: number | null;
  error: string | null;
}
interface Dependencies {
  load(backendTripId: string, signal: AbortSignal): Promise<ChatSummary>;
  notify(summary: ChatSummary, backendTripId: string): void;
  clear(bookingId: string | null): void;
}
/** One active-trip metadata request at a time. Push invalidates; foreground-only fallback is 15–60s. */
export class ChatNotifications {
  private state: ChatNoticeState = {
    backendTripId: null,
    bookingId: null,
    unreadCount: null,
    error: null,
  };
  private listeners = new Set<() => void>();
  private uid: string | null = null;
  private trip: NotificationTrip | null = null;
  private allowed = false;
  private foreground = false;
  private view: { ref: NotificationConversation; uid: string } | null = null;
  private epoch = 0;
  private controller?: AbortController;
  private work?: Promise<ChatSummary | null>;
  private timer?: ReturnType<typeof setTimeout>;
  private again = false;
  private stopped = false;
  private failures = 0;
  private seen = new Set<string>();
  constructor(private deps: Dependencies) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(update: Partial<ChatNoticeState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach(listener => listener());
  }
  private cancel() {
    ++this.epoch;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.controller = undefined;
    this.work = undefined;
    this.again = false;
  }
  private reset() {
    this.cancel();
    this.deps.clear(this.state.bookingId);
    this.seen.clear();
    this.failures = 0;
    this.stopped = false;
    this.publish({
      backendTripId: this.trip?.paymentTripId ?? null,
      bookingId: null,
      unreadCount: null,
      error: null,
    });
  }
  setSession(uid: string | null) {
    if (uid === this.uid) return;
    this.uid = uid;
    if (this.view?.uid !== uid) this.view = null;
    this.reset();
    this.refresh().catch(() => {});
  }
  setTrip(trip: NotificationTrip | null) {
    const next =
      trip?.paymentTripId &&
      ![trip.status, trip.engineStatus].some(status =>
        ['COMPLETED', 'CANCELLED'].includes(String(status).toUpperCase()),
      )
        ? trip
        : null;
    if (
      next?.id === this.trip?.id &&
      next?.paymentTripId === this.trip?.paymentTripId
    )
      return;
    this.trip = next;
    this.reset();
    this.refresh().catch(() => {});
  }
  setAllowed(allowed: boolean) {
    if (this.allowed === allowed) return;
    this.allowed = allowed;
    if (!allowed) this.reset();
    else this.refresh().catch(() => {});
  }
  setForeground(active: boolean) {
    if (this.foreground === active) return;
    this.foreground = active;
    if (active) this.stopped = false;
    this.cancel();
    this.deps.clear(this.state.bookingId);
    if (active) this.refresh().catch(() => {});
  }
  setViewing(view: { ref: NotificationConversation; uid: string } | null) {
    this.view = view;
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.viewing()) this.deps.clear(this.state.bookingId);
    else this.refresh().catch(() => {});
  }
  private viewing() {
    return (
      this.view?.uid === this.uid &&
      (this.view?.ref.kind === 'TRIP'
        ? this.view.ref.id === this.trip?.paymentTripId
        : this.view?.ref.id === this.state.bookingId)
    );
  }
  private ready() {
    return (
      !!this.uid &&
      !!this.trip?.paymentTripId &&
      this.allowed &&
      this.foreground &&
      !this.stopped
    );
  }
  matches(ref: NotificationConversation, uid: string) {
    return (
      uid === this.uid &&
      (ref.kind === 'TRIP'
        ? ref.id === this.trip?.paymentTripId
        : ref.id === this.state.bookingId)
    );
  }
  async refreshAfterRead() {
    const epoch = this.epoch;
    await this.work;
    if (epoch !== this.epoch) return null;
    return this.refresh();
  }
  refresh(): Promise<ChatSummary | null> {
    if (!this.ready()) return Promise.resolve(null);
    if (this.work) {
      this.again = true;
      return this.work;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
    const epoch = this.epoch,
      backendTripId = this.trip!.paymentTripId!;
    const controller = new AbortController();
    this.controller = controller;
    const current = () => epoch === this.epoch && !controller.signal.aborted;
    const task = (async () => {
      try {
        const summary = await Promise.resolve().then(() =>
          this.deps.load(backendTripId, controller.signal),
        );
        if (!current()) return null;
        this.failures = 0;
        const latest = summary.unreadIds[summary.unreadIds.length - 1];
        const fresh = !!latest && !this.seen.has(latest);
        if (latest) {
          this.seen.add(latest);
          if (this.seen.size > 256)
            this.seen.delete(this.seen.values().next().value!);
        }
        this.publish({
          backendTripId,
          bookingId: summary.bookingId,
          unreadCount: summary.unreadCount,
          error: null,
        });
        if (summary.unreadCount === 0 || this.viewing())
          this.deps.clear(summary.bookingId);
        else if (fresh) this.deps.notify(summary, backendTripId);
        return summary;
      } catch (error) {
        if (current()) {
          ++this.failures;
          if (
            error instanceof NotificationError &&
            [401, 403, 404, 410].includes(error.status)
          ) {
            this.stopped = true;
            this.deps.clear(this.state.bookingId);
            this.publish({
              bookingId: null,
              unreadCount: null,
              error: error.message,
            });
          } else
            this.publish({
              error:
                'Could not refresh message notifications. Retrying when available.',
            });
        }
        return null;
      } finally {
        if (current()) {
          this.work = undefined;
          this.controller = undefined;
          if (this.again) {
            this.again = false;
            this.refresh().catch(() => {});
          } else if (this.ready() && !this.viewing())
            this.timer = setTimeout(() => {
              this.refresh().catch(() => {});
            }, Math.min(60000, 15000 * 2 ** Math.min(this.failures, 2)));
        }
      }
    })();
    this.work = task;
    return task;
  }
}
