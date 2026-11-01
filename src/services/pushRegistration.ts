import AsyncStorage from "@react-native-async-storage/async-storage";
import { PermissionsAndroid, Platform } from "react-native";
import { getAuth } from "@react-native-firebase/auth";
import {
  getMessaging,
  getToken,
  deleteToken,
  hasPermission,
  AuthorizationStatus,
} from "@react-native-firebase/messaging";
import { paymentsRequest } from "../api/payments";

interface Binding {
  uid: string;
  token: string;
  userId: string;
}
const KEY = "pickup.push.binding.v1";
const ASKED = "pickup.push.permissionAsked";
let activeUid: string | null = null;
let version = 0;
let ready = false;
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const result = queue.catch(() => {}).then(work);
  queue = result.catch(() => {});
  return result;
};
const bounded = async <T>(work: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Push setup timed out.")),
          10000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
const binding = async (): Promise<Binding | null> => {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : null;
};
export const startPushSession = (uid: string) => {
  activeUid = uid;
  ready = false;
  return ++version;
};
export const stopPushSession = (epoch: number) => {
  if (epoch === version) {
    activeUid = null;
    ready = false;
    version++;
  }
};
export const pushSessionReady = () =>
  ready && !!activeUid && getAuth().currentUser?.uid === activeUid;
const permission = async (prompt: boolean) => {
  if (Platform.OS !== "android") return false;
  if (Number(Platform.Version) >= 33) {
    if (
      await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      )
    )
      return true;
    if (!prompt || (await AsyncStorage.getItem(ASKED))) return false;
    await AsyncStorage.setItem(ASKED, "true");
    return (
      (await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      )) === PermissionsAndroid.RESULTS.GRANTED
    );
  }
  return (
    (await hasPermission(getMessaging())) === AuthorizationStatus.AUTHORIZED
  );
};
export const syncPushRegistration = (
  uid: string,
  epoch: number,
  prompt = false,
) =>
  serial(async () => {
    const current = () =>
      epoch === version &&
      activeUid === uid &&
      getAuth().currentUser?.uid === uid;
    if (!current()) return false;
    const previous = await binding();
    const allowed = await permission(prompt);
    if (!current()) return false;
    if (!allowed) {
      ready = false;
      if (previous?.uid === uid) {
        await paymentsRequest("/v1/notifications/tokens", {
          method: "DELETE",
          body: { token: previous.token },
          timeoutMs: 5000,
        });
        if (current()) {
          await bounded(deleteToken(getMessaging()));
          await AsyncStorage.removeItem(KEY);
        }
      }
      return false;
    }
    if (previous && previous.uid !== uid) {
      await bounded(deleteToken(getMessaging()));
      if (!current()) return false;
      await AsyncStorage.removeItem(KEY);
    }
    const token = await bounded(getToken(getMessaging()));
    if (!current()) return false;
    if (previous?.uid === uid && previous.token !== token) {
      await paymentsRequest("/v1/notifications/tokens", {
        method: "DELETE",
        body: { token: previous.token },
        timeoutMs: 5000,
      });
    }
    const result = await paymentsRequest<{
      token: string;
      userId: string;
      role: string;
    }>("/v1/notifications/tokens", {
      method: "POST",
      body: { token, role: "CUSTOMER", platform: "ANDROID", language: "en" },
      timeoutMs: 5000,
    });
    if (!current()) {
      if (getAuth().currentUser?.uid === uid)
        await paymentsRequest("/v1/notifications/tokens", {
          method: "DELETE",
          body: { token },
          timeoutMs: 5000,
        }).catch(() => {});
      return false;
    }
    if (!result.userId || result.token !== token || result.role !== "CUSTOMER")
      throw new Error("Device registration was not confirmed.");
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({ uid, token, userId: result.userId }),
    );
    ready = current();
    return ready;
  });
/** Called before Firebase signout while the old identity can still revoke its registration. */
export const retirePushRegistration = (uid?: string) => {
  activeUid = null;
  ready = false;
  version++;
  return serial(async () => {
    if (!uid || Platform.OS !== "android") return;
    const previous = await binding().catch(() => null);
    if (getAuth().currentUser?.uid !== uid) return;
    if (previous?.uid === uid)
      await paymentsRequest("/v1/notifications/tokens", {
        method: "DELETE",
        body: { token: previous.token },
        timeoutMs: 5000,
      }).catch(() => {});
    if (getAuth().currentUser?.uid !== uid) return;
    await bounded(deleteToken(getMessaging())).catch(() => {});
    const latest = await binding().catch(() => null);
    if (latest?.uid === uid) await AsyncStorage.removeItem(KEY);
  });
};
export const ownsPush = async (data?: Record<string, unknown>) => {
  if (!pushSessionReady() || data?.role !== "CUSTOMER") return false;
  const stored = await binding();
  return (
    !!stored &&
    stored.uid === activeUid &&
    getAuth().currentUser?.uid === stored.uid &&
    data.recipientId === stored.userId
  );
};
