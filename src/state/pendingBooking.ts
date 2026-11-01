import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import type { CreateRideInput } from '../api/types';
export interface PendingBooking { readonly input: CreateRideInput; readonly rideId?: string; }
const key = (uid: string) => `pickup.pendingBooking.${uid}`;
const flights = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();
export const bookingRevision = (uid: string) => revisions.get(uid) ?? 0;
export const bookingOwner = (): string => {
  const uid = getAuth().currentUser?.uid;
  if (!uid) throw new Error('Please sign in before booking.');
  return uid;
};
export const readPendingBooking = async (uid: string): Promise<PendingBooking | null> => {
  const raw = await AsyncStorage.getItem(key(uid));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!value?.input?.quoteId || !['PAY_AT_PICKUP', 'PAY_AT_DELIVERY'].includes(value.input.paymentMethod)) {
    throw new Error('Saved booking recovery data is unreadable. Please retry recovery.');
  }
  return value;
};
/** Serialize writes/clears so a late earlier write cannot resurrect a cleared journal. */
export const writePendingBooking = (uid: string, value: PendingBooking | null, expectedRevision?: number, expectedSnapshot?: { readonly value: PendingBooking | null }): Promise<void> => {
  if (expectedRevision !== undefined && expectedRevision !== bookingRevision(uid)) return Promise.reject(new Error('Booking recovery changed; retry from Home.'));
  if (!value) revisions.set(uid, bookingRevision(uid) + 1);
  const next = (flights.get(uid) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (expectedSnapshot) {
      const actual = await readPendingBooking(uid);
      if (JSON.stringify(actual) !== JSON.stringify(expectedSnapshot.value)) throw new Error('Booking changed while leaving. Resume the current booking before retrying.');
    }
    if (value) await AsyncStorage.setItem(key(uid), JSON.stringify(value));
    else await AsyncStorage.removeItem(key(uid));
  });
  flights.set(uid, next);
  void next.finally(() => { if (flights.get(uid) === next) flights.delete(uid); }).catch(() => {});
  return next;
};
