import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';

const LEGACY_KEY = 'driver.avatarUri';
export const avatarKey = (uid: string) =>
  `driver.avatarUri:${encodeURIComponent(uid)}`;
const localUri = (value: unknown): value is string =>
  typeof value === 'string' && /^(file|content):\/\//.test(value);
let writes: Promise<void> = Promise.resolve();
const ordered = <T>(work: () => Promise<T>): Promise<T> => {
  const next = writes.catch(() => {}).then(work);
  writes = next.then(
    () => {},
    () => {},
  );
  return next;
};
const current = (uid: string) => !!uid && getAuth().currentUser?.uid === uid;

/** A device-only preview reference, not a remote profile photo or a guaranteed permanent file. */
export const LocalAvatarStore = {
  async read(uid: string): Promise<string | undefined> {
    if (!current(uid)) return undefined;
    await writes;
    await AsyncStorage.removeItem(LEGACY_KEY); // An unowned old cache must never be migrated to this account.
    const value = await AsyncStorage.getItem(avatarKey(uid));
    return current(uid) && localUri(value) ? value : undefined;
  },
  save(uid: string, uri: string): Promise<void> {
    return ordered(async () => {
      if (!current(uid) || !localUri(uri))
        throw new Error('Your account changed. Please choose the photo again.');
      await AsyncStorage.removeItem(LEGACY_KEY);
      await AsyncStorage.setItem(avatarKey(uid), uri);
      if (!current(uid)) {
        await AsyncStorage.removeItem(avatarKey(uid));
        throw new Error('Your account changed. Please choose the photo again.');
      }
    });
  },
  clear(uid?: string | null): Promise<void> {
    return ordered(async () => {
      await Promise.all([
        AsyncStorage.removeItem(LEGACY_KEY),
        uid ? AsyncStorage.removeItem(avatarKey(uid)) : Promise.resolve(),
      ]);
    });
  },
};
