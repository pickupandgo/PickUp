import type { TripNotificationTarget } from './TripNotificationNavigation';
import { getAuth } from '@react-native-firebase/auth';
import {
  deleteToken,
  getMessaging,
  getToken,
} from '@react-native-firebase/messaging';
import { createNotificationBackend } from './NotificationBackend';
import { notificationInbox } from './NotificationInbox';
import { PushSession, type PushEnvelope } from './PushSession';
import { historyPushTypes, tripHistoryEvents } from '../trip/tripHistoryEvents';
import { incomingOffers } from '../trip/incomingOfferRuntime';
import { notificationHistory } from './NotificationApi';
import { chatUuid } from '../chat/ChatService';
import { createNotificationHistory } from './NotificationHistory';
import { createChatSummaryRequest } from './NotificationApi';
import { ChatNotifications } from './ChatNotifications';

type PushState = { banner: PushEnvelope | null; error: string | null };
let state: PushState = { banner: null, error: null };
const listeners = new Set<() => void>();
const update = (value: Partial<PushState>) => {
  state = { ...state, ...value };
  listeners.forEach(listener => listener());
};
let openInbox: ((id?: string, bookingId?: string, target?: TripNotificationTarget) => void) | null = null;
let pendingOpen: { uid: string; id?: string; bookingId?: string; target?: TripNotificationTarget } | null = null;
export const pushState = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  dismiss: () => update({ banner: null }),
};
export const chatNotifications = new ChatNotifications({
  load: async (id, signal) => {
    const user = getAuth().currentUser;
    if (!user) throw new Error('Sign in to view messages.');
    return createChatSummaryRequest(
      user,
      () => getAuth().currentUser?.uid === user.uid,
    )(id, signal);
  },
  notify: (summary, backendTripId) => {
    if (!summary.bookingId) return;
    notificationInbox.refresh().catch(() => {});
    update({
      banner: {
        messageId: `chat:${summary.unreadIds[summary.unreadIds.length - 1]}`,
        data: {
          notificationType: 'NEW_CHAT_MESSAGE',
          bookingId: summary.bookingId,
          tripId: backendTripId,
        },
      },
    });
  },
  clear: bookingId => {
    if (
      state.banner?.data?.notificationType === 'NEW_CHAT_MESSAGE' &&
      (!bookingId || state.banner.data.bookingId === bookingId)
    )
      update({ banner: null });
  },
});

export function openChatNotification(bookingId: string) {
  const uid = getAuth().currentUser?.uid;
  if (!uid || !chatUuid.test(bookingId)) return;
  if (openInbox) openInbox(undefined, bookingId);
  else pendingOpen = { uid, bookingId };
}
export function openTripNotification(target: TripNotificationTarget) {
  const uid = getAuth().currentUser?.uid;
  if (!uid) return;
  if (openInbox) openInbox(undefined, undefined, target);
  else pendingOpen = { uid, target };
}
export const pushSession = new PushSession({
  getToken: () => getToken(getMessaging()),
  deleteToken: () => deleteToken(getMessaging()),
  backend: user =>
    createNotificationBackend(
      user,
      () => getAuth().currentUser?.uid === user.uid,
    ),
  resetInbox: uid => {
    pendingOpen = null;
    notificationInbox.setSession(uid, notificationHistory);
  },
  refreshInbox: () => notificationInbox.refresh(),
  showBanner: banner => {
    // Recipient/account validation and deduplication happened in PushSession. A push
    // never creates an offer or decides acceptance; re-read the authenticated inbox.
    incomingOffers.refresh();
    update({ banner });
    if (typeof banner.data?.notificationType === 'string' && historyPushTypes.has(banner.data.notificationType)) tripHistoryEvents.invalidate();
  },
  chatChanged: () => {
    chatNotifications.refresh().catch(() => {});
  },
  clearBanner: () => update({ banner: null }),
  reportError: error => update({ error }),
  openInbox: id => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    if (openInbox) openInbox(id);
    else pendingOpen = { uid, id };
  },
  openChat: openChatNotification,
  openEvent: message => openTripNotification({
    type: String(message.data?.notificationType ?? ''),
    notificationId: typeof message.data?.notificationId === 'string' ? message.data.notificationId : undefined,
    bookingId: typeof message.data?.bookingId === 'string' ? message.data.bookingId : undefined,
    backendTripId: typeof message.data?.tripId === 'string' ? message.data.tripId : undefined,
  }),
});

/** Navigation mounts after Firebase restoration; retain only this session's validated tap. */
export function attachNotificationNavigation(
  open: (id?: string, bookingId?: string, target?: TripNotificationTarget) => void,
) {
  openInbox = open;
  if (pendingOpen && pendingOpen.uid === getAuth().currentUser?.uid)
    open(pendingOpen.id, pendingOpen.bookingId, pendingOpen.target);
  pendingOpen = null;
  return () => {
    if (openInbox === open) openInbox = null;
  };
}
