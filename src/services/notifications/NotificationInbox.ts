/** Only persisted, recipient-authorized backend records belong in the inbox. */
export interface PartnerNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  relatedEntityId?: string;
  relatedEntityType?: string;
}

export interface NotificationPage {
  items: PartnerNotification[];
  nextCursor: string | null;
  unreadCount: number;
}

/** Port for the missing backend history API. No speculative HTTP routes are called. */
export interface NotificationHistory {
  available: boolean;
  list(cursor?: string): Promise<NotificationPage>;
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
}

const unavailable = async (): Promise<never> => {
  throw new Error('Notification history is currently unavailable. Please try again later.');
};
export const unavailableHistory: NotificationHistory = {
  available: false, list: unavailable, markRead: unavailable, markAllRead: unavailable,
};

export interface InboxState {
  items: PartnerNotification[];
  unreadCount: number | null;
  nextCursor: string | null;
  loading: boolean;
  loadingMore: boolean;
  updating: boolean;
  error: string | null;
  available: boolean;
}
const emptyState = (): InboxState => ({ items: [], unreadCount: null, nextCursor: null,
  loading: false, loadingMore: false, updating: false, error: null, available: false });

export function mergeNotifications(items: PartnerNotification[]): PartnerNotification[] {
  return [...new Map(items.map(item => [item.id, item])).values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Session-scoped memory only. Late responses from a previous account are discarded. */
export class NotificationInbox {
  private state = emptyState();
  private listeners = new Set<() => void>();
  private session: string | null = null;
  private revision = 0;
  private mutation = 0;
  private history: NotificationHistory = unavailableHistory;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(update: Partial<InboxState>) {
    this.state = { ...this.state, ...update };
    this.listeners.forEach(listener => listener());
  }
  setSession(session: string | null, history = unavailableHistory) {
    if (session === this.session && history === this.history) return;
    this.revision++;
    this.mutation++;
    this.session = session;
    this.history = history;
    this.state = emptyState();
    this.publish({ available: history.available });
  }
  async refresh() {
    const revision = ++this.revision;
    if (!this.session) {
      this.publish({ ...emptyState(), error: 'Sign in to view your notifications.' });
      return;
    }
    this.publish({ loading: true, loadingMore: false, error: null });
    try {
      const page = await this.history.list();
      if (revision !== this.revision) return;
      this.publish({ items: mergeNotifications(page.items), unreadCount: page.unreadCount,
        nextCursor: page.nextCursor });
    } catch (error) {
      if (revision === this.revision) this.publish({ error: this.message(error) });
    } finally {
      if (revision === this.revision) this.publish({ loading: false });
    }
  }
  async loadMore() {
    if (!this.session || !this.state.nextCursor || this.state.loading || this.state.loadingMore || this.state.updating) return;
    const revision = this.revision;
    this.publish({ loadingMore: true, error: null });
    try {
      const page = await this.history.list(this.state.nextCursor!);
      if (revision !== this.revision) return;
      this.publish({ items: mergeNotifications([...this.state.items, ...page.items]),
        nextCursor: page.nextCursor, unreadCount: page.unreadCount });
    } catch (error) {
      if (revision === this.revision) this.publish({ error: this.message(error) });
    } finally {
      if (revision === this.revision) this.publish({ loadingMore: false });
    }
  }
  async markRead(id?: string) {
    if (!this.session || !this.state.available || this.state.updating) return;
    if (id && !this.state.items.some(item => item.id === id && item.readAt === null)) return;
    this.revision++;
    const mutation = ++this.mutation;
    const session = this.session;
    this.publish({ updating: true, loading: false, loadingMore: false, error: null });
    try {
      if (id) await this.history.markRead(id);
      else await this.history.markAllRead();
      if (mutation === this.mutation && session === this.session) await this.refresh();
    } catch (error) {
      if (mutation === this.mutation && session === this.session) this.publish({ error: this.message(error) });
    } finally {
      if (mutation === this.mutation && session === this.session) this.publish({ updating: false });
    }
  }
  private message(error: unknown) {
    return error instanceof Error ? error.message : 'Could not load notifications. Please try again.';
  }
}

export const notificationInbox = new NotificationInbox();

export function notificationPresentation(type: string): { category: string; icon: string } {
  if (/WALLET|RECHARGE/.test(type)) return { category: 'Wallet', icon: 'account_balance_wallet' };
  if (/EARNING/.test(type)) return { category: 'Earnings', icon: 'payments' };
  if (/VEHICLE/.test(type)) return { category: 'Vehicle', icon: 'local_shipping' };
  if (/KYC|DOCUMENT|IDENTITY/.test(type)) return { category: 'Verification', icon: 'verified_user' };
  if (/CHAT|MESSAGE/.test(type)) return { category: 'Message', icon: 'chat_bubble_outline' };
  if (/TRIP|RIDE|DRIVER_|STOP|BOOKING|PICKUP/.test(type)) return { category: 'Trip', icon: 'route' };
  return { category: 'Account', icon: 'notifications' };
}
