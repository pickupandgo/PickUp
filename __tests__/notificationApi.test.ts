import { getAuth } from '@react-native-firebase/auth';
import { notificationHistory, notificationPreferences } from '../src/services/notifications/NotificationApi';
jest.mock('../src/config/env', () => ({ env: { PAYMENTS_API_BASE_URL: 'https://backend.test', REQUEST_TIMEOUT_MS: 1000 } }));
jest.mock('@react-native-firebase/auth', () => ({ getAuth: jest.fn() }));
const user = { uid: 'driver-a', getIdToken: jest.fn(async () => 'synthetic-token') };
const id = '00000000-0000-4000-8000-000000000001';
const item = { id, type: 'WALLET_LOW', title: 'Server title', body: 'Server balance warning', createdAt: new Date().toISOString(), readAt: null, data: { relatedEntityType: 'wallet' } };
const previousFetch = globalThis.fetch;
const fetchMock = jest.fn();
beforeEach(() => { jest.mocked(getAuth).mockReturnValue({ currentUser: user } as never); globalThis.fetch=fetchMock; fetchMock.mockReset(); });
afterEach(() => { globalThis.fetch=previousFetch; });
function reply(data: unknown) { fetchMock.mockResolvedValue({ ok:true,status:200,json:async()=>data }); }
test('uses authenticated persisted history and the server unread count', async()=>{
  reply({ items:[item],unreadCount:12,nextCursor:null });
  expect(await notificationHistory.list()).toMatchObject({ unreadCount:12,items:[{id,title:'Server title'}] });
  expect(fetchMock).toHaveBeenCalledWith('https://backend.test/v1/notifications/inbox',expect.objectContaining({
    headers:expect.objectContaining({Authorization:'Bearer synthetic-token'}),
  }));
});
test('does not invent unread counts or acknowledge unsaved read state',async()=>{
  reply({items:[item],nextCursor:null});
  expect(await notificationHistory.list()).toMatchObject({ items:[{id}], unreadCount:null });
  reply({success:false});
  await expect(notificationHistory.markRead(id)).rejects.toThrow('not saved');
});
test('rejects late responses after logout or account switching',async()=>{
  fetchMock.mockImplementationOnce(async()=>({ok:true,status:200,json:async()=>{
    jest.mocked(getAuth).mockReturnValue({currentUser:{uid:'driver-b'}} as never);
    return {items:[item],unreadCount:12,nextCursor:null};
  }}));
  await expect(notificationHistory.list()).rejects.toThrow('session changed');
});
test('saves optional categories through the existing authenticated preferences contract',async()=>{
  const prefs={tripRequests:true,tripUpdates:true,walletPayments:false,verification:true,announcements:true,soundEnabled:true};
  reply(prefs);
  expect(await notificationPreferences({walletPayments:false})).toEqual(prefs);
  expect(fetchMock).toHaveBeenCalledWith('https://backend.test/v1/notifications/preferences',expect.objectContaining({
    method:'PUT',body:JSON.stringify({walletPayments:false}),
  }));
});
