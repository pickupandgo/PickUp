import { APP_NAME } from '../config/brand';
import { useEffect } from "react";
import { Alert, AppState, Platform } from "react-native";
import {
  getMessaging,
  getInitialNotification,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
} from "@react-native-firebase/messaging";
import {
  startPushSession,
  stopPushSession,
  syncPushRegistration,
  ownsPush,
} from "../services/pushRegistration";
import {
  queuePushOpen,
  flushPendingPush,
  clearPendingPush,
} from "../services/pushNavigation";
export const usePushNotifications = (uid: string | null, enabled: boolean) => {
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let disposed = false;
    const unsubscribeOpen = onNotificationOpenedApp(
      getMessaging(),
      queuePushOpen,
    );
    void getInitialNotification(getMessaging())
      .then((message) => {
        if (!disposed && message) queuePushOpen(message);
      })
      .catch(() => {});
    const unsubscribeMessage = onMessage(getMessaging(), async (message) => {
      if (
        !disposed &&
        AppState.currentState === "active" &&
        (await ownsPush(message.data))
      ) {
        Alert.alert(`${APP_NAME} update`, "Open your inbox to view this update.", [
          { text: "Later", style: "cancel" },
          {
            text: "Open",
            onPress: () => {
              if (!disposed) queuePushOpen(message);
            },
          },
        ]);
      }
    });
    return () => {
      disposed = true;
      unsubscribeOpen();
      unsubscribeMessage();
      clearPendingPush();
    };
  }, []);
  useEffect(() => {
    if (!uid || !enabled || Platform.OS !== "android") return;
    const epoch = startPushSession(uid);
    let disposed = false;
    let running = false;
    let again = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const sync = async (prompt = false) => {
      if (disposed) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      if (retry) clearTimeout(retry);
      try {
        await syncPushRegistration(uid, epoch, prompt);
        attempts = 0;
        if (!disposed) await flushPendingPush();
      } catch {
        if (!disposed)
          retry = setTimeout(
            () => {
              void sync();
            },
            Math.min(60000, 5000 * 2 ** Math.min(attempts++, 4)),
          );
      } finally {
        running = false;
        if (again && !disposed) {
          again = false;
          void sync();
        }
      }
    };
    void sync(true);
    const refresh = onTokenRefresh(getMessaging(), () => {
      void sync();
    });
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => {
      disposed = true;
      stopPushSession(epoch);
      refresh();
      foreground.remove();
      if (retry) clearTimeout(retry);
    };
  }, [uid, enabled]);
};
