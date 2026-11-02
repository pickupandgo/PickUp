import type { NotificationIdentity } from './NotificationBackend';

export interface PushEnvelope {
  messageId?: string;
  data?: Record<string, unknown>;
}
export interface PushDependencies {
  getToken(): Promise<string>;
  deleteToken(): Promise<void>;
  backend(user: NotificationIdentity): {
    register(token: string, language: string): Promise<{ userId?: string }>;
    unregister(token: string): Promise<unknown>;
  };
  resetInbox(uid: string | null): void;
  refreshInbox(): Promise<void>;
  showBanner(message: PushEnvelope): void;
  openInbox(notificationId?: string): void;
  clearBanner(): void;
  reportError(message: string | null): void;
}

/** Serializes device ownership changes and rejects stale/account-mismatched messages. */
export class PushSession {
  private user: NotificationIdentity | null = null;
  private recipientId: string | null = null;
  private registration: { user: NotificationIdentity; token: string; language: string } | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private seen = new Set<string>();
  private opened = new Set<string>();
  private pendingTap: PushEnvelope | null = null;
  private language = 'en';
  constructor(private deps: PushDependencies) {}
  private enqueue(work: () => Promise<void>) {
    const result = this.chain.then(work);
    this.chain = result.catch(() => {});
    return result;
  }
  setUser(user: NotificationIdentity | null, language = 'en') {
    this.language = language;
    if (user?.uid === this.user?.uid && this.user !== null) return this.register();
    this.epoch++;
    this.user = user;
    this.recipientId = null;
    this.seen.clear(); this.opened.clear();
    this.deps.clearBanner(); this.deps.reportError(null);
    this.deps.resetInbox(user?.uid ?? null);
    if (!user) { this.pendingTap = null; }
    return this.register();
  }
  register(refreshedToken?: string) {
    const user = this.user;
    const epoch = this.epoch;
    const language = this.language;
    return this.enqueue(async () => {
      if (epoch !== this.epoch) return;
      try {
        if (!user) { await this.removeRegistration(); return; }
        if (!refreshedToken && this.registration?.user.uid === user.uid && this.registration.language === language) return;
        if (refreshedToken && this.registration?.user.uid === user.uid && this.registration.token === refreshedToken && this.registration.language === language) return;
        const invalidated = await this.removeRegistration();
        if (epoch !== this.epoch) return;
        const token = invalidated ? await this.deps.getToken() : refreshedToken ?? await this.deps.getToken();
        if (epoch !== this.epoch) return;
        const result = await this.deps.backend(user).register(token, language);
        // Keep ownership even if the session changed during HTTP: the next queued operation removes it.
        this.registration = { user, token, language };
        if (epoch !== this.epoch) return;
        this.recipientId = result.userId ?? null;
        this.deps.reportError(null);
        await this.deps.refreshInbox();
        if (epoch === this.epoch && this.pendingTap) {
          const pending = this.pendingTap; this.pendingTap = null;
          this.tap(pending);
        }
      } catch {
        if (epoch === this.epoch) this.deps.reportError('Push alerts are currently unavailable. Open Notifications to retry.');
      }
    });
  }
  private async removeRegistration() {
    if (!this.registration) return false;
    const registered = this.registration;
    try {
      await this.deps.backend(registered.user).unregister(registered.token);
      this.registration = null;
      return false;
    } catch {
      // Offline cleanup/account switching: invalidate the installation token before
      // associating a replacement. Never reuse a token still owned by another account.
      await this.deps.deleteToken();
      this.registration = null;
      return true;
    }
  }
  /** Called BEFORE Firebase sign-out while DELETE can still authenticate. */
  async logout() {
    this.epoch++;
    this.user = null; this.recipientId = null; this.pendingTap = null;
    this.seen.clear(); this.opened.clear();
    this.deps.resetInbox(null); this.deps.clearBanner();
    await this.enqueue(async () => {
      try { await this.removeRegistration(); }
      finally { await this.deps.deleteToken(); }
    });
  }
  private matches(message: PushEnvelope) {
    return !!this.user && !!this.recipientId && message.data?.role === 'DRIVER' && message.data?.recipientId === this.recipientId;
  }
  private key(message: PushEnvelope) {
    const stableId = message.data?.notificationId ?? message.data?.eventId ?? message.messageId;
    return typeof stableId === 'string' && stableId.length > 0 ? stableId : null;
  }
  private remember(set: Set<string>, key: string) {
    set.add(key);
    if (set.size > 200) set.delete(set.values().next().value!);
  }
  receive(message: PushEnvelope) {
    if (!this.matches(message)) return;
    const key = this.key(message);
    if (!key || this.seen.has(key)) return;
    this.remember(this.seen, key);
    // Push is an invalidation hint, never a permanent business record or an unread-count increment.
    this.deps.refreshInbox().catch(() => {});
    this.deps.showBanner(message);
  }
  tap(message: PushEnvelope) {
    if (!this.recipientId) { this.pendingTap = message; return; }
    if (!this.matches(message)) return;
    const key = this.key(message);
    if (!key || this.opened.has(key)) return;
    this.remember(this.opened, key);
    this.deps.clearBanner();
    const id = message.data?.notificationId;
    this.deps.openInbox(typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id) ? id : undefined);
  }
}
