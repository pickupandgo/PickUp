import { createNavigationContainerRef } from "@react-navigation/native";
import type { RemoteMessage } from "@react-native-firebase/messaging";
import { ownsPush, pushSessionReady } from "./pushRegistration";
type Routes = {
  ActiveTripStack: { screen: string; params: { bookingId: string } };
  BookingStack: { screen: string; params: { paymentBookingId: string } };
  NotificationCenterScreen: undefined;
};
export const pushNavigationRef = createNavigationContainerRef<Routes>();
let pending: RemoteMessage | null = null;
let flushing = false;
const seen = new Set<string>();
export const clearPendingPush = () => {
  pending = null;
};
export const flushPendingPush = async () => {
  if (
    flushing ||
    !pending ||
    !pushSessionReady() ||
    !pushNavigationRef.isReady()
  )
    return;
  flushing = true;
  try {
    const message = pending;
    if (!(await ownsPush(message.data))) {
      if (pending === message) pending = null;
      return;
    }
    if (
      !pushSessionReady() ||
      !pushNavigationRef.isReady() ||
      pending !== message
    )
      return;
    pending = null;
    if (message.messageId && seen.has(message.messageId)) return;
    if (message.messageId) {
      seen.add(message.messageId);
      if (seen.size > 100) seen.delete(seen.values().next().value!);
    }
    const id = message.data?.bookingId;
    if (
      typeof id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    ) {
      pushNavigationRef.navigate("NotificationCenterScreen");
      return;
    }
    if (message.data?.notificationType === "NEW_CHAT_MESSAGE")
      pushNavigationRef.navigate("ActiveTripStack", {
        screen: "ActiveTripChatScreen",
        params: { bookingId: id },
      });
    else
      pushNavigationRef.navigate("BookingStack", {
        screen: "DigitalReceiptScreen",
        params: { paymentBookingId: id },
      });
  } finally {
    flushing = false;
  }
};
export const queuePushOpen = (message: RemoteMessage) => {
  pending = message;
  void flushPendingPush().catch(() => {});
};
