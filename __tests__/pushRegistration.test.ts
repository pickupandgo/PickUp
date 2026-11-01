import { Platform } from "react-native";
import { deleteToken, hasPermission } from "@react-native-firebase/messaging";
import { paymentsRequest } from "../src/api/payments";
import {
  startPushSession,
  stopPushSession,
  syncPushRegistration,
  ownsPush,
  retirePushRegistration,
} from "../src/services/pushRegistration";
let mockUser: any = { uid: "A" };
jest.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: mockUser }),
}));
const mockStore = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));
jest.mock("../src/api/payments", () => ({ paymentsRequest: jest.fn() }));
beforeEach(async () => {
  jest.clearAllMocks();
  mockStore.clear();
  mockUser = { uid: "A" };
  Object.defineProperty(Platform, "Version", { configurable: true, value: 32 });
  (paymentsRequest as jest.Mock).mockResolvedValue({
    token: "fake-fcm-test-token",
    userId: "backend-A",
    role: "CUSTOMER",
  });
});
it("requires server acknowledgement and the current recipient identity", async () => {
  const epoch = startPushSession("A");
  expect(await ownsPush({ role: "CUSTOMER", recipientId: "backend-A" })).toBe(
    false,
  );
  expect(await syncPushRegistration("A", epoch)).toBe(true);
  expect(await ownsPush({ role: "CUSTOMER", recipientId: "backend-A" })).toBe(
    true,
  );
  expect(await ownsPush({ role: "CUSTOMER", recipientId: "backend-B" })).toBe(
    false,
  );
  mockUser = { uid: "B" };
  expect(await ownsPush({ role: "CUSTOMER", recipientId: "backend-A" })).toBe(
    false,
  );
  stopPushSession(epoch);
});
it("ignores stale sessions", async () => {
  const epoch = startPushSession("A");
  stopPushSession(epoch);
  expect(await syncPushRegistration("A", epoch)).toBe(false);
  expect(paymentsRequest).not.toHaveBeenCalled();
});
it("revokes registration and deletes the native token on logout", async () => {
  const epoch = startPushSession("A");
  await syncPushRegistration("A", epoch);
  await retirePushRegistration("A");
  expect(paymentsRequest).toHaveBeenCalledWith(
    "/v1/notifications/tokens",
    expect.objectContaining({
      method: "DELETE",
      body: { token: "fake-fcm-test-token" },
    }),
  );
  expect(deleteToken).toHaveBeenCalled();
  expect(await ownsPush({ role: "CUSTOMER", recipientId: "backend-A" })).toBe(
    false,
  );
});
it("rejects a mismatched server acknowledgement", async () => {
  (paymentsRequest as jest.Mock).mockResolvedValue({
    token: "other",
    userId: "backend-A",
    role: "CUSTOMER",
  });
  const epoch = startPushSession("A");
  await expect(syncPushRegistration("A", epoch)).rejects.toThrow(
    "not confirmed",
  );
  expect(await ownsPush({ role: "CUSTOMER", recipientId: "backend-A" })).toBe(
    false,
  );
  stopPushSession(epoch);
});

it('does not register when notification permission is denied', async () => {
 (hasPermission as jest.Mock).mockResolvedValueOnce(0);
 const epoch = startPushSession('A');
 expect(await syncPushRegistration('A', epoch)).toBe(false);
 expect(paymentsRequest).not.toHaveBeenCalled();
 stopPushSession(epoch);
});
