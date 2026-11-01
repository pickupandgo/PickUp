import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchChatMessages, sendChatMessage, getCachedCustomerChat, setCachedCustomerChat, restoreCustomerChat } from '../src/services/chatService';
import ActiveTripChatScreen from '../src/screens/support/ActiveTripChatScreen';
import { BookingContext } from '../src/state/BookingContext';
const mockToken = jest.fn(async () => 'fake-test-token');
let mockUser: any = { uid: 'A', getIdToken: mockToken };
jest.mock('@react-native-firebase/auth', () => ({ getAuth: () => ({ currentUser: mockUser }) }));
jest.mock('../src/config/env', () => ({ env: { paymentsApiBaseUrl: 'https://pay.test', apiBaseUrl: 'https://engine.test' }, hasPaymentsConfig: () => true, hasApiConfig: () => true, assertApiConfig: () => {} }));
jest.mock('@react-native-async-storage/async-storage', () => {
 const values = new Map<string,string>();
 return { __esModule: true, default: { clear: jest.fn(async () => values.clear()), getItem: jest.fn(async (key: string) => values.get(key) ?? null), setItem: jest.fn(async (key: string, value: string) => { values.set(key,value); }), removeItem: jest.fn(async (key: string) => { values.delete(key); }) } };
});
const booking = '00000000-0000-4000-8000-000000000001';
const clientMessageId = 'client_message_123456789';
const record = (key = clientMessageId): any => ({ id: 'server-message', bookingId: booking, clientMessageId: key, text: 'Hello', senderRole: 'CUSTOMER', status: 'sent', timestamp: '2026-10-31T10:00:00Z' });
const response = (body: unknown, status = 200): Response => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) } as Response);
beforeEach(async () => { jest.clearAllMocks(); mockUser = { uid: 'A', getIdToken: mockToken }; await AsyncStorage.clear(); });

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
it('does not POST when the durable retry record cannot be saved', async () => {
 (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('storage unavailable'));
 globalThis.fetch = jest.fn();
 await expect(sendChatMessage(booking,'Hello',undefined,clientMessageId)).rejects.toThrow('storage unavailable');
 expect(fetch).not.toHaveBeenCalled();
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
