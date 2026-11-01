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
const checkOwner = (owner?: string) => { if (!owner || ownerId() !== owner) throw new Error('Your sign-in changed. Reopen chat.'); };
const path = (id: string) => {
 if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('A confirmed payment booking reference is required for chat.');
 return `/v1/bookings/${encodeURIComponent(id)}/chat`;
};
const key = (id: string, owner: string) => `customer.chat.v2.${owner}.${id}`;
const writes = new Map<string, Promise<void>>();
const sends = new Map<string, Promise<CustomerChatMessage>>();
export const newChatMessageId = () => `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
export const getCachedCustomerChat = async (id: string, owner = ownerId()): Promise<CustomerChatMessage[]> => {
 if (!owner) return [];
 const raw = await AsyncStorage.getItem(key(id, owner));
 if (!raw) return [];
 const parsed = JSON.parse(raw);
 return Array.isArray(parsed) ? parsed : [];
};
export const setCachedCustomerChat = async (id: string, messages: CustomerChatMessage[], owner = ownerId()): Promise<void> => {
 if (owner) await AsyncStorage.setItem(key(id, owner), JSON.stringify(messages));
};
const updateCache = async (id: string, owner: string, update: (messages: CustomerChatMessage[]) => CustomerChatMessage[]) => {
 const cacheKey = key(id, owner);
 const next = (writes.get(cacheKey) ?? Promise.resolve()).catch(() => {}).then(async () => {
  const current = await getCachedCustomerChat(id, owner);
  await setCachedCustomerChat(id, update(current), owner);
 });
 writes.set(cacheKey, next);
 try { await next; } finally { if (writes.get(cacheKey) === next) writes.delete(cacheKey); }
};
export const restoreCustomerChat = async (id: string): Promise<CustomerChatMessage[]> => {
 const owner = ownerId(); checkOwner(owner); path(id);
 let restored: CustomerChatMessage[] = [];
 await updateCache(id, owner!, current => {
  restored = current.map(message => message.status === 'sending' && !sends.has(`${owner}:${id}:${message.clientMessageId}`) ? { ...message, status: 'error' as const } : message);
  return restored;
 });
 checkOwner(owner); return restored;
};
const mapMessage = (value: any, id: string): CustomerChatMessage => {
 if (!value || value.bookingId !== id || typeof value.id !== 'string' || !value.id ||
     typeof value.timestamp !== 'string' || !Number.isFinite(Date.parse(value.timestamp)) ||
     !['CUSTOMER','DRIVER','SYSTEM','ADMIN'].includes(value.senderRole) || !['sent','delivered','read','sending','error'].includes(value.status)) {
   throw new ApiError('parse', 'Unconfirmed chat response');
 }
 return { id: value.id, clientMessageId: value.clientMessageId ?? undefined, text: value.text, imageUrl: value.imageUrl ?? undefined,
  sender: value.senderRole === 'DRIVER' ? 'driver' : value.senderRole === 'CUSTOMER' ? 'customer' : 'system', timestamp: value.timestamp, status: value.status };
};
export const fetchChatMessages = async (id: string, signal?: AbortSignal): Promise<CustomerChatMessage[]> => {
 const owner = ownerId(); checkOwner(owner);
 const records = await paymentsRequest<unknown>(`${path(id)}/messages`, { signal });
 checkOwner(owner); if (signal?.aborted) throw new Error('Chat request cancelled');
 if (!Array.isArray(records)) throw new ApiError('parse', 'Invalid chat history');
 const remote = records.map(record => mapMessage(record, id));
 let merged = remote;
 await updateCache(id, owner!, current => {
  const serverKeys = new Set(remote.map(message => message.clientMessageId).filter(Boolean));
  merged = [...remote, ...current.filter(message => !serverKeys.has(message.clientMessageId) && !remote.some(item => item.id === message.id))];
  return merged;
 }).catch(() => {});
 return merged;
};
export const sendChatMessage = async (id: string, text: string, imageUrl?: string, clientMessageId = newChatMessageId(), signal?: AbortSignal): Promise<CustomerChatMessage> => {
 const owner = ownerId(); checkOwner(owner); path(id);
 if (!text.trim() || text.trim().length > 2000) throw new Error('Messages must contain 1 to 2000 characters.');
 const flightKey = `${owner}:${id}:${clientMessageId}`;
 if (sends.has(flightKey)) return sends.get(flightKey)!;
 const task = (async () => {
  const pending: CustomerChatMessage = { id: `local:${clientMessageId}`, clientMessageId, text: text.trim(), imageUrl, sender: 'customer', timestamp: new Date().toISOString(), status: 'sending' };
  // Durable retry identity before POST. A failed local write must not send an untraceable message.
  await updateCache(id, owner!, current => [...current.filter(message => message.clientMessageId !== clientMessageId), pending]);
  checkOwner(owner);
  try {
   const response = await paymentsRequest<unknown>(`${path(id)}/messages`, { method: 'POST', body: { text: pending.text, imageUrl, clientMessageId }, signal });
   checkOwner(owner);
   const confirmed = mapMessage(response, id);
   if (confirmed.clientMessageId !== clientMessageId) throw new ApiError('parse', 'Message acknowledgement does not match');
   await updateCache(id, owner!, current => [...current.filter(message => message.clientMessageId !== clientMessageId), confirmed]).catch(() => {});
   return confirmed;
  } catch (error) {
   // A polling response may already have confirmed this send while its POST response was lost.
   const known = (await getCachedCustomerChat(id, owner).catch(() => [])).find(message =>
     message.clientMessageId === clientMessageId && !message.id.startsWith('local:') &&
     ['sent','delivered','read'].includes(message.status) && message.text === pending.text &&
     (message.imageUrl ?? null) === (pending.imageUrl ?? null));
   if (known) { checkOwner(owner); return known; }
   await updateCache(id, owner!, current => current.map(message => message.clientMessageId === clientMessageId ? { ...message, status: 'error' } : message)).catch(() => {});
   throw error;
  }
 })();
 sends.set(flightKey, task);
 try { return await task; } finally { if (sends.get(flightKey) === task) sends.delete(flightKey); }
};
export const markCustomerChatRead = async (id: string, signal?: AbortSignal): Promise<void> => {
 const owner = ownerId(); checkOwner(owner);
 await paymentsRequest(`${path(id)}/read`, { method: 'POST', body: {}, signal }); checkOwner(owner);
};
