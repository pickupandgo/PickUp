import { notificationCopy } from './NotificationCopy';
import { createNotificationRequest, notificationUuid } from './NotificationApi';
import type { NotificationIdentity } from './NotificationBackend';
import type {
  NotificationHistory,
  NotificationPage,
  PartnerNotification,
} from './NotificationInbox';

/** Adapter for the already deployed inbox/read APIs; there is no invented mark-all endpoint. */
export function createNotificationHistory(
  user: NotificationIdentity,
  isCurrent: () => boolean,
): NotificationHistory {
  const request = createNotificationRequest(user, isCurrent);
  const list = async (cursor?: string): Promise<NotificationPage> => {
    if (cursor && !notificationUuid.test(cursor))
      throw new Error('Invalid notification cursor.');
    const payload = (await request(
      '/v1/notifications/inbox' +
        (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''),
    )) as { items?: unknown; nextCursor?: unknown; unreadCount?: unknown };
    if (
      !payload ||
      !Array.isArray(payload.items) ||
      !(
        payload.nextCursor === null ||
        (typeof payload.nextCursor === 'string' &&
          notificationUuid.test(payload.nextCursor))
      )
    )
      throw new Error('Notification response could not be verified.');
    const items: PartnerNotification[] = payload.items.map(row => {
      if (
        !row ||
        typeof row.id !== 'string' ||
        !notificationUuid.test(row.id) ||
        typeof row.type !== 'string' ||
        typeof row.title !== 'string' ||
        typeof row.body !== 'string' ||
        !Number.isFinite(Date.parse(row.createdAt)) ||
        !(
          row.readAt === null ||
          (typeof row.readAt === 'string' &&
            Number.isFinite(Date.parse(row.readAt)))
        )
      )
        throw new Error('Notification response could not be verified.');
      const bookingId =
        typeof row.data?.bookingId === 'string' &&
        notificationUuid.test(row.data.bookingId)
          ? row.data.bookingId
          : undefined;
      const backendTripId =
        typeof row.data?.tripId === 'string' &&
        notificationUuid.test(row.data.tripId)
          ? row.data.tripId
          : undefined;
      return {
        id: row.id,
        type: row.type,
        ...notificationCopy(row.type),
        createdAt: row.createdAt,
        readAt: row.readAt,
        bookingId,
        backendTripId,
        relatedEntityId: bookingId,
        relatedEntityType: bookingId ? 'Booking' : undefined,
      };
    });
    // The deployed response does not contain a global unread count. Never present one page as the total.
    const unreadCount =
      typeof payload.unreadCount === 'number' &&
      Number.isSafeInteger(payload.unreadCount) &&
      payload.unreadCount >= 0
        ? payload.unreadCount
        : !cursor && payload.nextCursor === null
        ? items.filter(item => item.readAt === null).length
        : null;
    return {
      items,
      nextCursor: payload.nextCursor as string | null,
      unreadCount,
    };
  };
  const markRead = async (id: string) => {
    if (!notificationUuid.test(id))
      throw new Error('Invalid notification reference.');
    const result = (await request(
      `/v1/notifications/inbox/${id}/read`,
      'POST',
      {},
    )) as { success?: unknown } | null;
    if (result?.success !== true)
      throw new Error('Notification read state was not confirmed.');
  };
  return {
    available: true,
    list,
    markRead,
    markAllRead: async () => {
      const ids = new Set<string>();
      let cursor: string | undefined;
      // Bound user-initiated bulk work; fail explicitly instead of claiming incomplete work succeeded.
      for (let page = 0; page < 10; page++) {
        const result = await list(cursor);
        for (const item of result.items)
          if (item.readAt === null) ids.add(item.id);
        if (!result.nextCursor) {
          for (const id of ids) await markRead(id);
          return;
        }
        if (result.nextCursor === cursor)
          throw new Error('Notification pagination did not advance.');
        cursor = result.nextCursor;
      }
      throw new Error(
        'Too many notifications to update at once. Mark individual notifications instead.',
      );
    },
  };
}
