import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { paymentsRequest } from '../api/payments';
import { ApiError } from '../api/http';

export interface CustomerChatMessage {
 readonly id: string; readonly clientMessageId?: string; readonly text?: string; readonly imageUrl?: string;
 readonly sender: 'customer' | 'driver' | 'system'; readonly timestamp: string;
 readonly status: 'sending' | 'sent' | 'delivered' | 'read' | 'error';
}
const ownerId = () => getAuth().currentUser?.uid;
const checkOwner = (owner?: string) => { if (!owner || ownerId() !== owner) throw new ApiError('session_changed', 'Your sign-in changed. Reopen chat.'); };
const path = (id: string) => {
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('A confirmed payment booking reference is required for chat.');
 return `/v1/bookings/${encodeURIComponent(id)}/chat`;
};
const key = (id: string, owner: string) => `customer.chat.v2.${owner}.${id}`;
const writes = new Map<string, Promise<void>>();
const sends = new Map<string, Promise<CustomerChatMessage>>();
const memory = new Map<string, CustomerChatMessage[]>();
const revisions = new Map<string, number>();
let generation = 0;
let memoryOwner: string | undefined;
export const clearCustomerChatMemory = () => { ++generation; memory.clear(); revisions.clear(); writes.clear(); sends.clear(); memoryOwner = ownerId(); };
const syncOwner = () => { if (memoryOwner !== ownerId()) clearCustomerChatMemory(); };
export const clearCustomerChatConversation = (id: string, owner = ownerId()) => {
 if (!owner) return;
 const cacheKey = key(id, owner); memory.delete(cacheKey); revisions.set(cacheKey, (revisions.get(cacheKey) ?? 0) + 1);
};
/** Remove only legacy chat copies, never other account/application storage. */
export const purgeLegacyCustomerChat = async () => {
 const keys = (await AsyncStorage.getAllKeys()).filter(value => value.startsWith('customer.chat.'));
 for (let index = 0; index < keys.length; index += 100) await AsyncStorage.multiRemove(keys.slice(index, index + 100));
};
const scope = (id: string) => {
 syncOwner(); const owner = ownerId(); checkOwner(owner); path(id);
 const started = generation, revision = revisions.get(key(id, owner!)) ?? 0;
 return {owner: owner!, check: () => { checkOwner(owner); if (generation !== started || (revisions.get(key(id, owner!)) ?? 0) !== revision) throw new ApiError('session_changed', 'This chat session ended.'); }};
};
export const newChatMessageId = () => `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
export const getCachedCustomerChat = async (id: string, owner = ownerId()): Promise<CustomerChatMessage[]> => {
 syncOwner(); if (!owner || owner !== ownerId()) return [];
 return (memory.get(key(id, owner)) ?? []).map(message => ({...message}));
};
export const setCachedCustomerChat = async (id: string, messages: CustomerChatMessage[], owner = ownerId()): Promise<void> => {
 syncOwner(); if (owner && owner === ownerId()) memory.set(key(id, owner), messages.map(message => ({...message})));
};
const updateCache = async (id: string, owner: string, update: (messages: CustomerChatMessage[]) => CustomerChatMessage[]) => {
 const cacheKey = key(id, owner);
 const epoch = generation, revision = revisions.get(cacheKey) ?? 0;
 const ensureCurrent = () => { checkOwner(owner); if (generation !== epoch || (revisions.get(cacheKey) ?? 0) !== revision) throw new ApiError('session_changed', 'This chat session ended.'); };
 const next = (writes.get(cacheKey) ?? Promise.resolve()).catch(() => {}).then(async () => {
  ensureCurrent();
  const current = await getCachedCustomerChat(id, owner);
  if (generation !== epoch || (revisions.get(cacheKey) ?? 0) !== revision) throw new ApiError('session_changed', 'This chat session ended.');
  await setCachedCustomerChat(id, update(current), owner);
 });
 writes.set(cacheKey, next);
 try { await next; } finally { if (writes.get(cacheKey) === next) writes.delete(cacheKey); }
};
export const restoreCustomerChat = async (id: string): Promise<CustomerChatMessage[]> => {
 const session = scope(id), owner = session.owner;
 let restored: CustomerChatMessage[] = [];
 await updateCache(id, owner!, current => {
  restored = current.map(message => message.status === 'sending' && !sends.has(`${owner}:${generation}:${id}:${message.clientMessageId}`) ? { ...message, status: 'error' as const } : message);
  return restored;
 });
 session.check(); return restored;
};
const mapMessage = (value: any, id: string): CustomerChatMessage => {
 if (!value || value.bookingId !== id || typeof value.id !== 'string' || !value.id ||
     typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) ||
     !['CUSTOMER','DRIVER','SYSTEM','ADMIN'].includes(value.senderRole) || !['sent','delivered','read','sending','error'].includes(value.status)) {
   throw new ApiError('parse', 'Unconfirmed chat response');
 }
 return { id: value.id, clientMessageId: value.clientMessageId ?? undefined, text: value.text,
  sender: value.senderRole === 'DRIVER' ? 'driver' : value.senderRole === 'CUSTOMER' ? 'customer' : 'system', timestamp: value.timestamp, status: value.status };
};
export const fetchChatMessages = async (id: string, signal?: AbortSignal): Promise<CustomerChatMessage[]> => {
 const session = scope(id), owner = session.owner;
 let records: unknown;
 try { records = await paymentsRequest<unknown>(`${path(id)}/messages`, { signal }); }
 catch(error) { session.check(); if (error instanceof ApiError && [401,403,410].includes(error.status ?? 0)) clearCustomerChatConversation(id, owner); throw error; }
 session.check(); if (signal?.aborted) throw new Error('Chat request cancelled');
 if (!Array.isArray(records)) throw new ApiError('parse', 'Invalid chat history');
 const remote = records.map(record => mapMessage(record, id));
 let merged = remote;
 await updateCache(id, owner!, current => {
  const serverKeys = new Set(remote.map(message => message.clientMessageId).filter(Boolean));
  merged = [...remote, ...current.filter(message => !serverKeys.has(message.clientMessageId) && !remote.some(item => item.id === message.id))];
  return merged;
 }).catch(() => {});
 session.check(); return merged;
};
export const sendChatMessage = async (id: string, text: string, imageUrl?: string, clientMessageId = newChatMessageId(), signal?: AbortSignal): Promise<CustomerChatMessage> => {
 const session = scope(id), owner = session.owner;
 if (imageUrl) throw new Error('Chat attachments are not enabled.');
 if (!text.trim() || text.trim().length > 2000) throw new Error('Messages must contain 1 to 2000 characters.');
 const flightKey = `${owner}:${generation}:${id}:${clientMessageId}`;
 if (sends.has(flightKey)) return sends.get(flightKey)!;
 const task = (async () => {
  const pending: CustomerChatMessage = { id: `local:${clientMessageId}`, clientMessageId, text: text.trim(), imageUrl, sender: 'customer', timestamp: new Date().toISOString(), status: 'sending' };
  // Active-session retry identity. Messages are never copied to permanent phone storage.
  await updateCache(id, owner!, current => [...current.filter(message => message.clientMessageId !== clientMessageId), pending]);
  session.check();
  try {
   const response = await paymentsRequest<unknown>(`${path(id)}/messages`, { method: 'POST', body: { text: pending.text, imageUrl, clientMessageId }, signal });
   session.check();
   const confirmed = mapMessage(response, id);
   if (confirmed.clientMessageId !== clientMessageId) throw new ApiError('parse', 'Message acknowledgement does not match');
   await updateCache(id, owner!, current => [...current.filter(message => message.clientMessageId !== clientMessageId), confirmed]).catch(() => {});
   session.check();
   return confirmed;
  } catch (error) {
   session.check();
   if (error instanceof ApiError && [401,403,410].includes(error.status ?? 0)) { clearCustomerChatConversation(id, owner); throw error; }
   session.check();
   // A polling response may already have confirmed this send while its POST response was lost.
   const known = (await getCachedCustomerChat(id, owner).catch(() => [])).find(message =>
     message.clientMessageId === clientMessageId && !message.id.startsWith('local:') &&
     ['sent','delivered','read'].includes(message.status) && message.text === pending.text &&
     (message.imageUrl ?? null) === (pending.imageUrl ?? null));
   if (known) { session.check(); return known; }
   await updateCache(id, owner!, current => current.map(message => message.clientMessageId === clientMessageId ? { ...message, status: 'error' } : message)).catch(() => {});
   throw error;
  }
 })();
 sends.set(flightKey, task);
 try { return await task; } finally { if (sends.get(flightKey) === task) sends.delete(flightKey); }
};
export const markCustomerChatRead = async (id: string, signal?: AbortSignal): Promise<void> => {
 const session = scope(id);
 try { await paymentsRequest(`${path(id)}/read`, { method: 'POST', body: {}, signal }); }
 catch(error) { session.check(); if (error instanceof ApiError && [401,403,410].includes(error.status ?? 0)) clearCustomerChatConversation(id, session.owner); throw error; }
 session.check();
};
