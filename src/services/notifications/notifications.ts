import { getAuth } from '@react-native-firebase/auth';
import { deleteToken, getMessaging, getToken } from '@react-native-firebase/messaging';
import { createNotificationBackend } from './NotificationBackend';
import { notificationInbox } from './NotificationInbox';
import { PushSession, type PushEnvelope } from './PushSession';

type PushState = { banner: PushEnvelope | null; error: string | null };
let state: PushState = { banner: null, error: null };
const listeners = new Set<() => void>();
const update = (value: Partial<PushState>) => {
  state = { ...state, ...value }; listeners.forEach(listener => listener());
};
let openInbox: ((id?: string) => void) | null = null;
let pendingOpen: { uid: string; id?: string } | null = null;
export const pushState = {
  getSnapshot: () => state,
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  dismiss: () => update({ banner: null }),
};
export const pushSession = new PushSession({
  getToken: () => getToken(getMessaging()),
  deleteToken: () => deleteToken(getMessaging()),
  backend: user => createNotificationBackend(user, () => getAuth().currentUser?.uid === user.uid),
  resetInbox: uid => { pendingOpen = null; notificationInbox.setSession(uid); },
  refreshInbox: () => notificationInbox.refresh(),
  showBanner: banner => update({ banner }),
  clearBanner: () => update({ banner: null }),
  reportError: error => update({ error }),
  openInbox: id => {
    const uid = getAuth().currentUser?.uid;
    if (!uid) return;
    if (openInbox) openInbox(id);
    else pendingOpen = { uid, id };
  },
});

/** Navigation mounts after Firebase restoration; retain only this session's validated tap. */
export function attachNotificationNavigation(open: (id?: string) => void) {
  openInbox = open;
  if (pendingOpen && pendingOpen.uid === getAuth().currentUser?.uid) open(pendingOpen.id);
  pendingOpen = null;
  return () => { if (openInbox === open) openInbox = null; };
}
