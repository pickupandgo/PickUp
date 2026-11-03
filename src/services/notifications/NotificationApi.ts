import { env } from '../../config/env';
import type { NotificationIdentity } from './NotificationBackend';

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
