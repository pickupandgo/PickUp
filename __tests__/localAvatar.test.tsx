import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { launchImageLibrary } from 'react-native-image-picker';
import {
  LocalAvatarStore,
  avatarKey,
} from '../src/services/account/LocalAvatarStore';
import { useLocalAvatar } from '../src/hooks/useLocalAvatar';
let mockUid = 'a';
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: { uid: mockUid } }),
}));
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
}));
const storage = new Map<string, string>();
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => {
    resolve = yes;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
let avatar: ReturnType<typeof useLocalAvatar>;
function Probe() {
  avatar = useLocalAvatar();
  return null;
}
const mount = async () => {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(<Probe />);
  });
  await act(async () => {
    await flush();
  });
  return view;
};
beforeEach(() => {
  mockUid = 'a';
  storage.clear();
  jest.clearAllMocks();
  jest
    .mocked(AsyncStorage.getItem)
    .mockImplementation(async key => storage.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    storage.set(key, value);
  });
  jest.mocked(AsyncStorage.removeItem).mockImplementation(async key => {
    storage.delete(key);
  });
  jest
    .mocked(launchImageLibrary)
    .mockResolvedValue({ assets: [{ uri: 'file:///new-photo.jpg' }] });
});
test('discards the unowned legacy cache and never borrows another UID photo', async () => {
  storage.set('driver.avatarUri', 'file:///unowned.jpg');
  storage.set(avatarKey('a'), 'file:///a.jpg');
  mockUid = 'b';
  await expect(LocalAvatarStore.read('b')).resolves.toBeUndefined();
  expect(storage.has('driver.avatarUri')).toBe(false);
  expect(storage.get(avatarKey('a'))).toBe('file:///a.jpg');
  mockUid = 'a';
  await expect(LocalAvatarStore.read('a')).resolves.toBe('file:///a.jpg');
});
test('logout cleanup is ordered after an in-flight save and never clears the next account', async () => {
  const write = deferred<void>();
  jest
    .mocked(AsyncStorage.setItem)
    .mockImplementationOnce(async (key, value) => {
      await write.promise;
      storage.set(key, value);
    });
  storage.set(avatarKey('b'), 'file:///b.jpg');
  const save = LocalAvatarStore.save('a', 'file:///a.jpg').catch(
    error => error,
  );
  await flush();
  const clear = LocalAvatarStore.clear('a');
  mockUid = 'b';
  expect(storage.get(avatarKey('b'))).toBe('file:///b.jpg');
  write.resolve();
  await Promise.all([save, clear]);
  expect(storage.has(avatarKey('a'))).toBe(false);
  expect(storage.get(avatarKey('b'))).toBe('file:///b.jpg');
});
test('a remote URI or wrong current identity cannot become a local photo', async () => {
  await expect(
    LocalAvatarStore.save('a', 'https://other.example/photo'),
  ).rejects.toThrow();
  mockUid = 'b';
  await expect(LocalAvatarStore.save('a', 'file:///a.jpg')).rejects.toThrow();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});
test('a queued UI callback cannot reopen the gallery after its screen unmounts', async () => {
  const view = await mount(); const choose = avatar.choose;
  await act(async () => view.unmount());
  await choose(); expect(launchImageLibrary).not.toHaveBeenCalled();
});
test('a slow restore cannot overwrite a newer gallery choice', async () => {
  const old = deferred<string | null>();
  jest.mocked(AsyncStorage.getItem).mockReturnValueOnce(old.promise);
  const view = await mount();
  await act(async () => {
    await avatar.choose();
  });
  await act(async () => {
    old.resolve('file:///old.jpg');
    await flush();
  });
  expect(avatar.uri).toBe('file:///new-photo.jpg');
  expect(storage.get(avatarKey('a'))).toBe(avatar.uri);
  await act(async () => view.unmount());
});
test('late picker results and cleanup cannot update or unlock the next account picker', async () => {
  const a = deferred<any>(),
    b = deferred<any>();
  jest
    .mocked(launchImageLibrary)
    .mockReturnValueOnce(a.promise)
    .mockReturnValueOnce(b.promise);
  const view = await mount();
  let workA!: Promise<void>, workB!: Promise<void>;
  await act(async () => {
    workA = avatar.choose();
  });
  mockUid = 'b';
  await act(async () => {
    view.update(<Probe />);
    await flush();
  });
  await act(async () => {
    workB = avatar.choose();
  });
  await act(async () => {
    a.resolve({ assets: [{ uri: 'file:///private-a.jpg' }] });
    await workA;
  });
  expect(avatar.uri).toBeUndefined();
  await act(async () => {
    await avatar.choose();
  });
  expect(launchImageLibrary).toHaveBeenCalledTimes(2);
  await act(async () => {
    b.resolve({ assets: [{ uri: 'file:///b.jpg' }] });
    await workB;
  });
  expect(avatar.uri).toBe('file:///b.jpg');
  expect(storage.has(avatarKey('a'))).toBe(false);
  await act(async () => view.unmount());
});
test('failed persistence is not shown as a successful save, and removal clears only this device reference', async () => {
  const view = await mount();
  jest
    .mocked(AsyncStorage.setItem)
    .mockRejectedValueOnce(new Error('storage failed'));
  await act(async () => {
    await avatar.choose();
  });
  expect(avatar.uri).toBeUndefined();
  expect(avatar.error).toContain('Could not save');
  await act(async () => {
    await avatar.choose();
  });
  expect(avatar.uri).toBe('file:///new-photo.jpg');
  await act(async () => {
    avatar.remove();
    await flush();
  });
  expect(avatar.uri).toBeUndefined();
  expect(storage.has(avatarKey('a'))).toBe(false);
  await act(async () => view.unmount());
});
