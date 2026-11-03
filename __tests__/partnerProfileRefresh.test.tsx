import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { usePartnerProfile } from '../src/hooks/usePartnerProfile';

let mockFocused = true;
let mockUser: { uid: string } | null = { uid: 'partner-a' };
const mockAuthListeners = new Set<(user: typeof mockUser) => void>();
const profile = { driverId: 'driver-a', name: 'Server name', phone: '+919000000001', email: null, address: null, photoUrl: null, approvalStatus: 'APPROVED' };
const mockService = { load: jest.fn(async (_uid: string) => profile), saveName: jest.fn(async (_uid: string, _driver: string, _name: string) => 'Saved name') };
jest.mock('../src/services/profile/PartnerProfileService', () => ({ partnerProfileService: {
  load: (uid: string) => mockService.load(uid), saveName: (uid: string, driver: string, name: string) => mockService.saveName(uid, driver, name),
} }));
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }), onAuthStateChanged: (_auth: unknown, listener: (user: typeof mockUser) => void) => {
  mockAuthListeners.add(listener); return () => mockAuthListeners.delete(listener);
} }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: () => void | (() => void)) => {
  const ReactModule = require('react'); ReactModule.useEffect(() => { if (mockFocused) return callback(); }, [callback, mockFocused]);
} }));
const states: Record<string, ReturnType<typeof usePartnerProfile>> = {};
function Harness({ id }: { id: string }) { states[id] = usePartnerProfile(); return null; }
let view: Renderer.ReactTestRenderer;
const mount = async () => { await act(async () => { view = Renderer.create(<Harness id="editor" />); }); };
beforeEach(() => { jest.clearAllMocks(); mockFocused = true; mockUser = { uid: 'partner-a' }; mockService.load.mockResolvedValue(profile); mockService.saveName.mockResolvedValue('Saved name'); });
afterEach(async () => { if (view) await act(() => view.unmount()); expect(mockAuthListeners.size).toBe(0); });

test('Profile focus and returning from editor read fresh server state', async () => {
  await mount(); expect(states.editor.profile?.name).toBe('Server name');
  mockFocused = false; await act(() => view.update(<Harness id="editor" />));
  mockService.load.mockResolvedValue({ ...profile, name: 'Updated on server' });
  mockFocused = true; await act(async () => view.update(<Harness id="editor" />));
  expect(states.editor.profile?.name).toBe('Updated on server'); expect(mockService.load).toHaveBeenCalledTimes(2);
});
test('confirmed save refreshes another mounted consumer and publishes only the acknowledged name', async () => {
  await act(async () => { view = Renderer.create(<><Harness id="editor" /><Harness id="profile" /></>); });
  mockService.load.mockResolvedValue({ ...profile, name: 'Saved name' });
  await act(async () => { await states.editor.saveName('Draft name'); });
  expect(mockService.saveName).toHaveBeenCalledWith('partner-a', 'driver-a', 'Draft name');
  expect(states.editor.profile?.name).toBe('Saved name'); expect(states.profile.profile?.name).toBe('Saved name');
  expect(mockService.load).toHaveBeenCalledTimes(3);
});
test('duplicate saves are blocked while pending; backend failure never changes the confirmed profile', async () => {
  await mount(); let reject: (error: Error) => void = () => {};
  mockService.saveName.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  let pending: Promise<unknown> = Promise.resolve();
  await act(() => { pending = states.editor.saveName('Draft').catch(error => error); });
  expect(states.editor.saving).toBe(true);
  await expect(states.editor.saveName('Duplicate')).rejects.toThrow('already in progress');
  await act(async () => { reject(new Error('Server failure')); await pending; });
  expect(states.editor.profile?.name).toBe('Server name'); expect(states.editor.saving).toBe(false); expect(mockService.saveName).toHaveBeenCalledTimes(1);
});
test('logout clears account data and discards a pending acknowledgement from a previous session', async () => {
  await mount(); let resolve: (name: string) => void = () => {};
  mockService.saveName.mockImplementation(() => new Promise(done => { resolve = done; }));
  let pending: Promise<unknown> = Promise.resolve();
  await act(() => { pending = states.editor.saveName('Draft').catch(error => error); });
  mockUser = null; await act(async () => { mockAuthListeners.forEach(listener => listener(null)); });
  expect(states.editor.profile).toBeNull();
  await act(async () => { resolve('Old session name'); await pending; });
  expect(states.editor.profile).toBeNull(); expect(states.editor.error).toMatch(/sign in/i);
});
test('expired save session clears the old profile rather than report a successful update', async () => {
  await mount(); mockService.saveName.mockRejectedValue(Object.assign(new Error('Expired'), { status: 401 }));
  await act(async () => { await states.editor.saveName('Draft').catch(() => {}); });
  expect(states.editor.profile).toBeNull(); expect(states.editor.error).toMatch(/sign in/i);
});
test('leaving editor during a save still refreshes the now-visible Profile after the acknowledgement', async () => {
  await act(async () => { view = Renderer.create(<Harness key="editor" id="editor" />); });
  let resolve: (name: string) => void = () => {};
  mockService.saveName.mockImplementation(() => new Promise(done => { resolve = done; }));
  let pending: Promise<unknown> = Promise.resolve();
  await act(() => { pending = states.editor.saveName('Draft'); });
  await act(async () => view.update(<Harness key="profile" id="profile" />));
  expect(states.profile.profile?.name).toBe('Server name');
  mockService.load.mockResolvedValue({ ...profile, name: 'Saved name' });
  await act(async () => { resolve('Saved name'); await pending; });
  expect(states.profile.profile?.name).toBe('Saved name');
});
