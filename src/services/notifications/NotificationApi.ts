import { getAuth } from '@react-native-firebase/auth';
import { env } from '../../config/env';
import type { NotificationHistory, PartnerNotification } from './NotificationInbox';
import type { NotificationIdentity } from './NotificationBackend';

async function request(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<unknown> {
  const user = getAuth().currentUser;
  if (!user || !env.PAYMENTS_API_BASE_URL) throw new Error('Sign in to view notifications.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await user.getIdToken(attempt === 1);
    if (getAuth().currentUser?.uid !== user.uid) throw new Error('Notification session changed.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${env.PAYMENTS_API_BASE_URL}/v1/notifications/${path}`, {
        method, signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 401 && attempt === 0) continue;
      if (!response.ok) throw new Error('Notification service unavailable. Please retry.');
      const data = await response.json();
      if (getAuth().currentUser?.uid !== user.uid) throw new Error('Notification session changed.');
      return data;
    } finally { clearTimeout(timer); }
  }
  throw new Error('Sign in again to access notifications.');
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid notification response.');
  return value as Record<string, unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const success = (value: unknown) => { if (record(value).success !== true) throw new Error('Read status was not saved.'); };
export const notificationHistory: NotificationHistory = {
  available: true,
  async list(cursor) {
    if (cursor && !uuid.test(cursor)) throw new Error('Invalid notification cursor.');
    const data = record(await request('GET', `inbox${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`));
    if (!Array.isArray(data.items) || (data.unreadCount !== undefined && data.unreadCount !== null &&
      (!Number.isSafeInteger(data.unreadCount) || (data.unreadCount as number) < 0)) ||
      !(data.nextCursor === null || typeof data.nextCursor === 'string' && uuid.test(data.nextCursor))) throw new Error('Could not load notification history. Please try again.');
    const items: PartnerNotification[] = data.items.map(value => {
      const row = record(value);
      if (typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.type !== 'string' ||
        typeof row.title !== 'string' || typeof row.body !== 'string' ||
        typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) ||
        !(row.readAt === null || typeof row.readAt === 'string' && Number.isFinite(Date.parse(row.readAt)))) throw new Error('Could not load notification history. Please try again.');
      const metadata = row.data && typeof row.data === 'object' ? row.data as Record<string, unknown> : {};
      return { id: row.id, type: row.type, title: row.title, body: row.body, createdAt: row.createdAt, readAt: row.readAt,
        relatedEntityId: typeof metadata.relatedEntityId === 'string' ? metadata.relatedEntityId : undefined,
        relatedEntityType: typeof metadata.relatedEntityType === 'string' ? metadata.relatedEntityType : undefined };
    });
    return { items, unreadCount: typeof data.unreadCount === 'number' ? data.unreadCount : null, nextCursor: data.nextCursor as string | null };
  },
  async markRead(id) {
    if (!uuid.test(id)) throw new Error('Invalid notification id.');
    success(await request('POST', `inbox/${id}/read`));
  },
  async markAllRead() { success(await request('POST', 'inbox/read-all')); },
};
export const preferenceKeys = ['tripRequests','tripUpdates','walletPayments','verification','announcements','soundEnabled'] as const;
export type NotificationPreferences = Record<typeof preferenceKeys[number], boolean>;
export async function notificationPreferences(update?: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const data = record(await request(update ? 'PUT' : 'GET', 'preferences', update));
  if (!preferenceKeys.every(key => typeof data[key] === 'boolean')) throw new Error('Notification preferences are currently unavailable. Please try again later.');
  return Object.fromEntries(preferenceKeys.map(key => [key, data[key]])) as NotificationPreferences;
}

export const notificationUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class NotificationError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

/** Existing Backend contracts only; bounded across token acquisition, HTTP and body decoding. */
export function createNotificationRequest(
  user: NotificationIdentity,
  isCurrent: () => boolean,
) {
  return async (
    path: string,
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    body?: object,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const base = env.PAYMENTS_API_BASE_URL?.replace(/\/+$/, '');
    if (!base || !/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(base))
      throw new NotificationError('Notification service is not configured.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    let interrupt!: () => void;
    const interrupted = new Promise<never>((_resolve, reject) => {
      interrupt = () =>
        reject(
          new NotificationError(
            'Notification request interrupted. Please retry.',
          ),
        );
    });
    interrupted.catch(() => undefined);
    controller.signal.addEventListener('abort', interrupt, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, env.REQUEST_TIMEOUT_MS ?? 15000);
    const check = () => {
      if (!isCurrent())
        throw new NotificationError('Notification session changed.');
      if (controller.signal.aborted)
        throw new NotificationError('Notification request interrupted.');
    };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        check();
        const token = await Promise.race([
          user.getIdToken(attempt === 1),
          interrupted,
        ]);
        check();
        const response = await Promise.race([
          fetch(base + path, {
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
        if (!response.ok)
          throw new NotificationError(
            response.status === 410
              ? 'This trip has ended. Chat is closed.'
              : response.status === 403
              ? 'This conversation is not available to this account.'
              : 'Notification service is temporarily unavailable. Please retry.',
            response.status,
          );
        return payload;
      }
      throw new NotificationError(
        'Notification registration needs a valid sign-in session.',
        401,
      );
    } catch (error) {
      if (error instanceof NotificationError) throw error;
      throw new NotificationError(
        'Notification service is temporarily unavailable. Please retry.',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      controller.signal.removeEventListener('abort', interrupt);
    }
  };
}

export interface ChatSummary {
  bookingId: string | null;
  unreadCount: number;
  unreadIds: string[];
}
export function createChatSummaryRequest(
  user: NotificationIdentity,
  isCurrent: () => boolean,
) {
  const request = createNotificationRequest(user, isCurrent);
  return async (
    backendTripId: string,
    signal?: AbortSignal,
  ): Promise<ChatSummary> => {
    if (!notificationUuid.test(backendTripId))
      throw new NotificationError('Assignment confirmation is pending.', 409);
    const payload = await request(
      `/v1/trips/${backendTripId}/chat/messages`,
      'GET',
      undefined,
      signal,
    );
    if (!Array.isArray(payload))
      throw new NotificationError(
        'Notification response could not be verified.',
      );
    let bookingId: string | null = null;
    const unreadIds: string[] = [];
    for (const row of payload) {
      if (
        !row ||
        typeof row.id !== 'string' ||
        !notificationUuid.test(row.bookingId) ||
        !['CUSTOMER', 'DRIVER', 'ADMIN', 'SYSTEM'].includes(row.senderRole) ||
        !['sent', 'delivered', 'read', 'sending', 'error'].includes(row.status)
      )
        throw new NotificationError(
          'Notification response could not be verified.',
        );
      if (bookingId && bookingId !== row.bookingId)
        throw new NotificationError('Conversation references do not match.');
      bookingId = row.bookingId;
      if (
        row.senderRole === 'CUSTOMER' &&
        row.readAt == null &&
        ['sent', 'delivered'].includes(row.status)
      )
        unreadIds.push(row.id);
    }
    // Never retain message bodies in notification state or persist push payloads.
    return {
      bookingId,
      unreadCount: new Set(unreadIds).size,
      unreadIds: [...new Set(unreadIds)],
    };
  };
}
