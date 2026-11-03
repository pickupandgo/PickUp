export type NotificationConversation = { kind: 'TRIP' | 'BOOKING'; id: string };
type View = {
  ref: NotificationConversation;
  uid: string;
  lease: object;
} | null;
type Event =
  | { type: 'view'; view: View }
  | {
      type: 'read';
      ref: NotificationConversation;
      uid: string;
      confirmed: boolean;
    };
const listeners = new Set<(event: Event) => void>();
let view: View = null;
export const chatNotificationSignals = {
  subscribe(listener: (event: Event) => void) {
    listeners.add(listener);
    listener({ type: 'view', view });
    return () => {
      listeners.delete(listener);
    };
  },
  viewing(ref: NotificationConversation, uid: string) {
    const lease = {};
    view = { ref, uid, lease };
    listeners.forEach(listener => listener({ type: 'view', view }));
    return () => {
      if (view?.lease === lease) {
        view = null;
        listeners.forEach(listener => listener({ type: 'view', view: null }));
      }
    };
  },
  read(ref: NotificationConversation, uid: string, confirmed = true) {
    listeners.forEach(listener =>
      listener({ type: 'read', ref, uid, confirmed }),
    );
  },
};
