import { getAuth } from '@react-native-firebase/auth';
import { env } from '../../config/env';
import type { ChatMessage } from '../../types/chat';

export type ChatConversation = { kind: 'TRIP' | 'BOOKING'; id: string };
export const chatUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class ChatError extends Error {
  constructor(readonly code: string, message: string, readonly status = 0) {
    super(message);
  }
}
interface ChatIdentity {
  uid: string;
  getIdToken(refresh?: boolean): Promise<string>;
}
interface Dependencies {
  user(): ChatIdentity | null;
  transport: typeof fetch;
  baseUrl(): string | undefined;
}
export interface IChatService {
  getMessages(
    conversation: ChatConversation,
    signal?: AbortSignal,
  ): Promise<ChatMessage[]>;
  sendMessage(
    conversation: ChatConversation,
    text: string,
    clientMessageId?: string,
    signal?: AbortSignal,
  ): Promise<ChatMessage>;
  markAsRead(
    conversation: ChatConversation,
    signal?: AbortSignal,
  ): Promise<void>;
}
/** An idempotency reference, never an authentication credential. */
export const newChatMessageId = () =>
  `chat_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}_${Math.random().toString(36).slice(2)}`;
export const conversationKey = (ref: ChatConversation) =>
  `${ref.kind}:${ref.id}`;

/** Temporary, account-scoped RAM only. No permanent chat copy or offline auto-send queue. */
export class ApiChatService implements IChatService {
  private uid?: string;
  private epoch = 0;
  private controllers = new Set<AbortController>();
  private messages = new Map<string, ChatMessage[]>();
  private revisions = new Map<string, number>();
  private sends = new Map<string, Promise<ChatMessage>>();
  private blocked = false;
  private listeners = new Set<() => void>();
  constructor(
    private readonly deps: Dependencies = {
      user: () => getAuth().currentUser,
      transport: (...args) => fetch(...args),
      baseUrl: () => env.PAYMENTS_API_BASE_URL,
    },
  ) {}
  clear(blockForSignout = false) {
    const uid = this.deps.user()?.uid;
    if (this.uid !== uid) this.blocked = false;
    if (blockForSignout) this.blocked = true;
    ++this.epoch;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.messages.clear();
    this.revisions.clear();
    this.sends.clear();
    this.uid = uid;
    for (const listener of this.listeners) listener();
  }
  subscribePrivacy(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private session() {
    const user = this.deps.user();
    if (this.uid !== user?.uid) this.clear();
    if (!user || this.blocked)
      throw new ChatError(
        'AUTH_REQUIRED',
        'Please sign in to use trip chat.',
        401,
      );
    const epoch = this.epoch;
    return {
      user,
      current: () => epoch === this.epoch && this.deps.user()?.uid === user.uid,
    };
  }
  forget(ref: ChatConversation) {
    const key = conversationKey(ref);
    this.messages.delete(key);
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
  }
  private conversationSession(ref: ChatConversation) {
    const session = this.session(),
      key = conversationKey(ref);
    const revision = this.revisions.get(key) ?? 0;
    return {
      ...session,
      revision,
      current: () =>
        session.current() && revision === (this.revisions.get(key) ?? 0),
    };
  }
  private path(ref: ChatConversation) {
    if (!chatUuid.test(ref.id) || !['TRIP', 'BOOKING'].includes(ref.kind)) {
      throw new ChatError(
        'CHAT_NOT_ASSIGNED',
        'Chat is waiting for confirmed driver assignment.',
        409,
      );
    }
    return `/v1/${ref.kind === 'TRIP' ? 'trips' : 'bookings'}/${ref.id}/chat`;
  }
  private async request(
    ref: ChatConversation,
    suffix: string,
    method: 'GET' | 'POST',
    body?: object,
    signal?: AbortSignal,
  ) {
    const path = this.path(ref);
    const base = this.deps.baseUrl()?.replace(/\/+$/, '');
    if (!base || !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(base))
      throw new ChatError(
        'CONFIGURATION',
        'The chat service is not configured.',
      );
    const session = this.session();
    const controller = new AbortController();
    this.controllers.add(controller);
    const abort = () => controller.abort();
    let interrupt!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = () =>
        reject(
          new ChatError(
            'INTERRUPTED',
            'Chat could not be confirmed. Refresh or retry.',
          ),
        );
    });
    // A pre-aborted caller may fail before awaiting this promise.
    interrupted.catch(() => undefined);
    controller.signal.addEventListener('abort', interrupt, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, 15_000);
    const check = () => {
      if (!session.current())
        throw new ChatError('SESSION_CHANGED', 'Your chat session ended.');
      if (controller.signal.aborted)
        throw new ChatError(
          'INTERRUPTED',
          'Chat could not be confirmed. Refresh or retry.',
        );
    };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        check();
        const token = await Promise.race([
          session.user.getIdToken(attempt === 1),
          interrupted,
        ]);
        check();
        const response = await Promise.race([
          this.deps.transport(base + path + suffix, {
            method,
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
          }),
          interrupted,
        ]);
        check();
        if (response.status === 401 && attempt === 0) continue;
        const payload: unknown = await Promise.race([
          response.json().catch(() => null),
          interrupted,
        ]);
        check();
        if (!response.ok) {
          const supplied = (payload as { error?: { code?: unknown } } | null)
            ?.error?.code;
          const code =
            typeof supplied === 'string' && /^[A-Z0-9_]{1,80}$/.test(supplied)
              ? supplied
              : 'CHAT_UNAVAILABLE';
          if ([401, 403, 410].includes(response.status)) this.forget(ref);
          throw new ChatError(
            code,
            response.status === 410
              ? 'This trip has ended. Chat is closed.'
              : response.status === 403
              ? 'You cannot access this trip chat.'
              : response.status === 409
              ? 'Chat is not available until assignment is confirmed.'
              : 'Chat could not be confirmed. Please retry.',
            response.status,
          );
        }
        return payload;
      }
      throw new ChatError('AUTH_REQUIRED', 'Please sign in again.', 401);
    } catch (error) {
      if (error instanceof ChatError) throw error;
      throw new ChatError(
        'NETWORK',
        'Chat could not be confirmed. Check your connection and retry.',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', interrupt);
      this.controllers.delete(controller);
    }
  }
  private map(value: unknown, ref: ChatConversation): ChatMessage {
    const row = value as Record<string, unknown> | null;
    if (
      !row ||
      typeof row.id !== 'string' ||
      !chatUuid.test(String(row.bookingId)) ||
      (ref.kind === 'BOOKING' && row.bookingId !== ref.id) ||
      typeof row.timestamp !== 'string' ||
      !Number.isFinite(Date.parse(row.timestamp)) ||
      !['CUSTOMER', 'DRIVER', 'SYSTEM', 'ADMIN'].includes(
        String(row.senderRole),
      ) ||
      !['sent', 'delivered', 'read', 'sending', 'error'].includes(
        String(row.status),
      ) ||
      typeof row.text !== 'string' ||
      (row.clientMessageId != null && typeof row.clientMessageId !== 'string')
    )
      throw new ChatError(
        'INVALID_RESPONSE',
        'Chat returned an unconfirmed response.',
      );
    return {
      id: row.id,
      bookingId: String(row.bookingId),
      text: row.text,
      clientMessageId: row.clientMessageId as string | undefined,
      sender:
        row.senderRole === 'DRIVER'
          ? 'driver'
          : row.senderRole === 'CUSTOMER'
          ? 'customer'
          : 'system',
      timestamp: row.timestamp,
      status: row.status as ChatMessage['status'],
    };
  }
  async getMessages(ref: ChatConversation, signal?: AbortSignal) {
    const session = this.conversationSession(ref),
      key = conversationKey(ref);
    const payload = await this.request(
      ref,
      '/messages',
      'GET',
      undefined,
      signal,
    );
    if (!session.current())
      throw new ChatError('SESSION_CHANGED', 'Your chat session ended.');
    if (!Array.isArray(payload))
      throw new ChatError(
        'INVALID_RESPONSE',
        'Chat history could not be verified.',
      );
    const remote = payload.map(row => this.map(row, ref));
    if (new Set(remote.map(row => row.bookingId)).size > 1)
      throw new ChatError('INVALID_RESPONSE', 'Chat references do not match.');
    const keys = new Set(
      remote.map(row => row.clientMessageId).filter(Boolean),
    );
    const pending = (this.messages.get(key) ?? []).filter(
      row =>
        !keys.has(row.clientMessageId) &&
        !remote.some(item => item.id === row.id),
    );
    const merged = [...remote, ...pending];
    this.messages.set(key, merged);
    return merged;
  }
  sendMessage(
    ref: ChatConversation,
    text: string,
    clientMessageId = newChatMessageId(),
    signal?: AbortSignal,
  ) {
    const session = this.conversationSession(ref),
      key = conversationKey(ref),
      sendKey = `${session.user.uid}:${this.epoch}:${session.revision}:${key}:${clientMessageId}`;
    this.path(ref);
    if (
      !text.trim() ||
      text.trim().length > 2000 ||
      !/^[A-Za-z0-9_-]{16,100}$/.test(clientMessageId)
    )
      return Promise.reject(
        new ChatError('VALIDATION', 'Enter a message of 1–2000 characters.'),
      );
    if (this.sends.has(sendKey)) return this.sends.get(sendKey)!;
    const pending: ChatMessage = {
      id: `local:${clientMessageId}`,
      clientMessageId,
      text: text.trim(),
      sender: 'driver',
      timestamp: new Date().toISOString(),
      status: 'sending',
    };
    this.messages.set(key, [
      ...(this.messages.get(key) ?? []).filter(
        row => row.clientMessageId !== clientMessageId,
      ),
      pending,
    ]);
    const task = (async () => {
      try {
        const confirmed = this.map(
          await this.request(
            ref,
            '/messages',
            'POST',
            { text: pending.text, clientMessageId },
            signal,
          ),
          ref,
        );
        if (!session.current())
          throw new ChatError('SESSION_CHANGED', 'Your chat session ended.');
        if (
          confirmed.clientMessageId !== clientMessageId ||
          confirmed.text !== pending.text ||
          !['sent', 'delivered', 'read'].includes(confirmed.status)
        )
          throw new ChatError(
            'INVALID_RESPONSE',
            'The send acknowledgement does not match.',
          );
        this.messages.set(key, [
          ...(this.messages.get(key) ?? []).filter(
            row =>
              row.clientMessageId !== clientMessageId &&
              row.id !== confirmed.id,
          ),
          confirmed,
        ]);
        return confirmed;
      } catch (error) {
        const known = this.messages
          .get(key)
          ?.find(
            row =>
              row.clientMessageId === clientMessageId &&
              row.text === pending.text &&
              !row.id.startsWith('local:') &&
              ['sent', 'read', 'delivered'].includes(row.status),
          );
        if (session.current() && known) return known;
        if (
          session.current() &&
          !(
            error instanceof ChatError && [410, 403, 401].includes(error.status)
          )
        )
          this.messages.set(
            key,
            (this.messages.get(key) ?? []).map(row =>
              row.clientMessageId === clientMessageId
                ? { ...row, status: 'error' }
                : row,
            ),
          );
        throw error;
      } finally {
        this.sends.delete(sendKey);
      }
    })();
    this.sends.set(sendKey, task);
    return task;
  }
  async markAsRead(ref: ChatConversation, signal?: AbortSignal) {
    await this.request(ref, '/read', 'POST', {}, signal);
  }
}
export class ChatService {
  private static instance: ApiChatService;
  static getInstance() {
    return (this.instance ??= new ApiChatService());
  }
}
