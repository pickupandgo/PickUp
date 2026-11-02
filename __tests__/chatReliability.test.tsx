import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchChatMessages, sendChatMessage, getCachedCustomerChat, setCachedCustomerChat, restoreCustomerChat, clearCustomerChatMemory, purgeLegacyCustomerChat } from '../src/services/chatService';
import ActiveTripChatScreen from '../src/screens/support/ActiveTripChatScreen';
import { BookingContext } from '../src/state/BookingContext';
import { useChatPrivacy, useChatTripPrivacy } from '../src/hooks/useChatPrivacy';
let mockPolledTrip: any;
jest.mock('../src/hooks/useTripStatus', () => ({ useTripStatus: () => ({ trip: mockPolledTrip }) }));
const mockToken = jest.fn(async () => 'fake-test-token');
let mockUser: any = { uid: 'A', getIdToken: mockToken };
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../src/config/env', () => ({ env: { paymentsApiBaseUrl: 'https://pay.test', apiBaseUrl: 'https://engine.test' }, hasPaymentsConfig: () => true, hasApiConfig: () => true, assertApiConfig: () => {} }));
jest.mock('@react-native-async-storage/async-storage', () => {
 const values = new Map<string,string>();
 return { __esModule: true, default: { clear: jest.fn(async () => values.clear()), getAllKeys: jest.fn(async () => [...values.keys()]), multiRemove: jest.fn(async (keys: string[]) => keys.forEach(key => values.delete(key))), getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { values.set(key,value); }), removeItem: jest.fn(async (key: string) => { values.delete(key); }) } };
});
const booking = '00000000-0000-4000-8000-000000000001';
const clientMessageId = 'client_message_123456789';
const record = (key = clientMessageId): any => ({ id: 'server-message', bookingId: booking, clientMessageId: key, text: 'Hello', senderRole: 'CUSTOMER', status: 'sent', timestamp: '2026-10-31T10:00:00Z' });
const response = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response);
beforeEach(async () => { jest.clearAllMocks(); mockPolledTrip = undefined; mockUser = { uid: 'A', getIdToken: mockToken }; clearCustomerChatMemory(); await AsyncStorage.clear(); });

it('fails HTTP sends truthfully, then retries with the same reference and one local row', async () => {
 globalThis.fetch = jest.fn().mockResolvedValueOnce(response({},503)).mockResolvedValueOnce(response(record()));
 await expect(sendChatMessage(booking,'Hello',undefined,clientMessageId)).rejects.toMatchObject({ status: 503 });
 expect((await getCachedCustomerChat(booking))[0].status).toBe('error');
 await expect(sendChatMessage(booking,'Hello',undefined,clientMessageId)).resolves.toMatchObject({ id: 'server-message', status: 'sent' });
 const calls = (fetch as jest.Mock).mock.calls;
 expect(calls).toHaveLength(2);
 expect(calls.every(call => JSON.parse(call[1].body).clientMessageId === clientMessageId)).toBe(true);
 expect(await getCachedCustomerChat(booking)).toHaveLength(1);
});
it('coalesces simultaneous retries of the same message', async () => {
 globalThis.fetch = jest.fn().mockResolvedValue(response(record()));
 await Promise.all([sendChatMessage(booking,'Hello',undefined,clientMessageId),sendChatMessage(booking,'Hello',undefined,clientMessageId)]);
 expect(fetch).toHaveBeenCalledTimes(1);
});
it('keeps retry state in RAM only and never writes messages to permanent phone storage', async () => {
 globalThis.fetch = jest.fn().mockResolvedValue(response(record()));
 await expect(sendChatMessage(booking,'Hello',undefined,clientMessageId)).resolves.toMatchObject({status:'sent'});
 expect(AsyncStorage.setItem).not.toHaveBeenCalled();
 clearCustomerChatMemory(); expect(await getCachedCustomerChat(booking)).toEqual([]);
});
it('purges only legacy chat copies, preserving all other storage', async () => {
 await AsyncStorage.setItem('customer.chat.v2.A.old', 'private message');
 await AsyncStorage.setItem('customer.chat.legacy', 'old message');
 await AsyncStorage.setItem('pickup.customerProfile', 'profile');
 await purgeLegacyCustomerChat();
 expect(await AsyncStorage.getAllKeys()).toEqual(['pickup.customerProfile']);
});
it('clears all cached conversation content on closed-trip responses', async () => {
 await setCachedCustomerChat(booking, [{id:'old', text:'private', sender:'customer', timestamp:new Date().toISOString(), status:'sent'}]);
 globalThis.fetch = jest.fn().mockResolvedValue(response({error:{code:'CHAT_CLOSED'}},410));
 await expect(fetchChatMessages(booking)).rejects.toMatchObject({status:410});
 expect(await getCachedCustomerChat(booking)).toEqual([]);
});
it('never falls back from a booking failure to an engine/trip endpoint', async () => {
 globalThis.fetch = jest.fn().mockResolvedValue(response({},404));
 await expect(sendChatMessage(booking,'Hello',undefined,clientMessageId)).rejects.toMatchObject({ status: 404 });
 expect(fetch).toHaveBeenCalledTimes(1); expect((fetch as jest.Mock).mock.calls[0][0]).toContain(`/bookings/${booking}/chat/messages`);
});
it('rejects shared placeholder conversation IDs before network access', async () => {
 globalThis.fetch = jest.fn(); await expect(sendChatMessage('active-trip','Hello')).rejects.toThrow('confirmed payment booking'); expect(fetch).not.toHaveBeenCalled();
});
it('refreshes a 401 token once using the shared transport', async () => {
 globalThis.fetch = jest.fn().mockResolvedValueOnce(response({},401)).mockResolvedValueOnce(response(record()));
 await sendChatMessage(booking,'Hello',undefined,clientMessageId);
 expect(mockToken).toHaveBeenCalledWith(false); expect(mockToken).toHaveBeenCalledWith(true); expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not represent failed history reads as a successful empty conversation', async () => {
 globalThis.fetch = jest.fn().mockResolvedValue(response({},503));
 await expect(fetchChatMessages(booking)).rejects.toMatchObject({ status: 503 });
});
it('reconciles an interrupted send from server history instead of duplicating it', async () => {
 await setCachedCustomerChat(booking,[{ id: 'local', clientMessageId, text: 'Hello', sender: 'customer', timestamp: new Date().toISOString(), status: 'sending' }]);
 expect((await restoreCustomerChat(booking))[0]).toMatchObject({ clientMessageId, status: 'error' });
 globalThis.fetch = jest.fn().mockResolvedValue(response([record()]));
 const messages = await fetchChatMessages(booking);
 expect(messages).toHaveLength(1); expect(messages[0].id).toBe('server-message');
});
it('rejects a mismatched acknowledgement and prevents cross-account late success', async () => {
 globalThis.fetch = jest.fn().mockResolvedValueOnce(response({ ...record(), clientMessageId: 'wrong' }));
 await expect(sendChatMessage(booking,'Hello',undefined,clientMessageId)).rejects.toMatchObject({ kind: 'parse' });
 let finish!: (value: Response) => void;
 (fetch as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
 const request = expect(fetchChatMessages(booking)).rejects.toMatchObject({ kind: 'session_changed' });
 // Allow token acquisition/fetch to begin before changing owner.
 for (let n=0;n<8;n++) await Promise.resolve();
 mockUser = { uid: 'B', getIdToken: mockToken }; finish(response([record()]));
 await request; expect(await getCachedCustomerChat(booking)).toEqual([]);
});
it('shows a failed bubble with Retry and replaces it only after server acknowledgement', async () => {
 let fail = true;
 globalThis.fetch = jest.fn(async (url: string, init: RequestInit) => {
  if (url.endsWith('/read')) return response({ updatedCount: 0 });
  if (init.method === 'POST') return fail ? response({},503) : response(record(JSON.parse(String(init.body)).clientMessageId));
  return response([]);
 }) as unknown as typeof fetch;
 let renderer!: ReactTestRenderer;
 await act(async () => { renderer = TestRenderer.create(<BookingContext.Provider value={{ trip: { id: 'engine-trip', paymentBookingId: booking }, draft: { drops: [] } } as any}><ActiveTripChatScreen /></BookingContext.Provider>); });
 act(() => (renderer.root.findByType(TextInput).props.onChangeText as (s: string) => void)('Hello'));
 await act(async () => { await (renderer.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Send message')[0].props.onPress(); });
 const text = () => renderer.root.findAllByType(Text).map(node => node.props.children).flat(Infinity).join(' ');
 expect(text()).toContain('Send not confirmed - Retry');
 fail = false;
 await act(async () => { (renderer.root as any).findAll((node: any) => node.props.accessibilityLabel === 'Retry message')[0].props.onPress(); });
 expect(text()).not.toContain('Send not confirmed - Retry');
 act(() => renderer.unmount());
});

it('clears visible chat and prevents sends immediately when the trip completes', async () => {
 globalThis.fetch = jest.fn(async (url:RequestInfo) => String(url).endsWith('/read') ? response({updatedCount:0}) : response([record()]));
 let renderer!: ReactTestRenderer;
 const state=(status:string)=>({trip:{id:'engine-trip',paymentBookingId:booking,status},draft:{drops:[]}} as any);
 try {
  await act(async()=>{renderer=TestRenderer.create(<BookingContext.Provider value={state('IN_TRANSIT')}><ActiveTripChatScreen /></BookingContext.Provider>);});
  expect(renderer.root.findByType(TextInput).props.editable).toBe(true);
  await act(async()=>renderer.update(<BookingContext.Provider value={state('COMPLETED')}><ActiveTripChatScreen /></BookingContext.Provider>));
  expect(renderer.root.findByType(TextInput).props.editable).toBe(false);
  const visible=renderer.root.findAllByType(Text).map(node=>node.props.children).flat(Infinity).join(' ');
  expect(visible).not.toContain('Hello'); expect(visible).toContain('Chat is closed');
  expect(await getCachedCustomerChat(booking)).toEqual([]);
 } finally {if(renderer) act(()=>renderer.unmount());}
});

it('ignores a previous chat session late denial without clearing the newly loaded conversation', async () => {
 let finish!: (value: Response) => void;
 globalThis.fetch = jest.fn(() => new Promise(resolve => { finish = resolve; }));
 const pending = expect(fetchChatMessages(booking)).rejects.toMatchObject({ kind: 'session_changed' });
 for(let n=0;n<8;n++) await Promise.resolve();
 clearCustomerChatMemory();
 await setCachedCustomerChat(booking, [{id:'new-session',text:'Fresh',sender:'driver',timestamp:new Date().toISOString(),status:'sent'}]);
 finish(response({error:{code:'FORBIDDEN'}},403));
 await pending;
 expect((await getCachedCustomerChat(booking))[0].text).toBe('Fresh');
});
it('does not invalidate the initial chat request when privacy hooks mount', async () => {
 globalThis.fetch = jest.fn(async () => response([]));
 const trip:any = {id:'engine-trip',paymentBookingId:booking,status:'IN_TRANSIT'};
 function Harness() { useChatPrivacy('A'); useChatTripPrivacy(trip); return <BookingContext.Provider value={{trip,draft:{drops:[]}} as any}><ActiveTripChatScreen /></BookingContext.Provider>; }
 let view:any;
 await act(async()=>{view=TestRenderer.create(<Harness />);});
 expect(view.root.findByType(TextInput).props.editable).toBe(true);
 act(()=>view.unmount());
});
it('closes a chat opened with old route props when the live trip completes', async () => {
 globalThis.fetch = jest.fn(async () => response([]));
 const trip:any={id:'engine-trip',paymentBookingId:booking,status:'IN_TRANSIT'};
 const render=()=> <BookingContext.Provider value={{trip,draft:{drops:[]}} as any}><ActiveTripChatScreen route={{params:{trip}}}/></BookingContext.Provider>;
 let view:any; await act(async()=>{view=TestRenderer.create(render());});
 expect(view.root.findByType(TextInput).props.editable).toBe(true);
 mockPolledTrip={...trip,status:'COMPLETED'};
 await act(async()=>view.update(render()));
 expect(view.root.findByType(TextInput).props.editable).toBe(false);
 expect(view.root.findAllByType(Text).map((node:any)=>node.props.children).flat().join(' ')).toContain('Chat is closed');
 act(()=>view.unmount());
});
it('trip-specific privacy cleanup leaves another conversation cache intact', async () => {
 const other='00000000-0000-4000-8000-000000000002';
 const message:any={id:'cached',text:'Keep',sender:'driver',timestamp:new Date().toISOString(),status:'sent'};
 await setCachedCustomerChat(booking,[message]); await setCachedCustomerChat(other,[message]);
 function Harness({status}:{status:string}) {useChatTripPrivacy({id:'old-trip',paymentBookingId:booking,status} as any);return null;}
 let view:any; await act(async()=>{view=TestRenderer.create(<Harness status="IN_TRANSIT"/>);});
 await act(async()=>view.update(<Harness status="COMPLETED"/>));
 expect(await getCachedCustomerChat(booking)).toEqual([]);
 expect(await getCachedCustomerChat(other)).toHaveLength(1);
 act(()=>view.unmount());
});
