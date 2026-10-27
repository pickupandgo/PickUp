import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { env } from '../config/env';
import { buildPaymentsUrl } from '../api/payments';

export interface CustomerChatMessage {
  readonly id: string;
  readonly text?: string;
  readonly imageUrl?: string;
  readonly sender: 'customer' | 'driver' | 'system';
  readonly timestamp: string;
  readonly status: 'sending' | 'sent' | 'delivered' | 'read' | 'error';
}

const getCacheKey = (conversationId: string) => `customer.chat.${conversationId}`;

export const getCachedCustomerChat = async (conversationId: string): Promise<CustomerChatMessage[]> => {
  try {
    const raw = await AsyncStorage.getItem(getCacheKey(conversationId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

export const setCachedCustomerChat = async (
  conversationId: string,
  messages: CustomerChatMessage[]
): Promise<void> => {
  try {
    await AsyncStorage.setItem(getCacheKey(conversationId), JSON.stringify(messages));
  } catch {}
};

const getAuthToken = async (): Promise<string | null> => {
  try {
    const user = getAuth().currentUser;
    if (user) {
      return await user.getIdToken();
    }
  } catch (err) {
    console.warn('[CUSTOMER CHAT] Failed to obtain Firebase ID token', err);
  }
  return null;
};

export const fetchChatMessages = async (
  bookingIdOrTripId: string
): Promise<CustomerChatMessage[]> => {
  const token = await getAuthToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const endpoints = [
    buildPaymentsUrl(env.paymentsApiBaseUrl, `/bookings/${encodeURIComponent(bookingIdOrTripId)}/chat/messages`),
    buildPaymentsUrl(env.paymentsApiBaseUrl, `/trips/${encodeURIComponent(bookingIdOrTripId)}/chat/messages`),
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: 'GET', headers });
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          const mapped: CustomerChatMessage[] = list.map((m: any) => ({
            id: m.id || `msg-${Date.now()}`,
            text: m.text,
            imageUrl: m.imageUrl || undefined,
            sender:
              m.senderRole === 'DRIVER' || m.sender === 'driver'
                ? 'driver'
                : m.senderRole === 'SYSTEM' || m.sender === 'system'
                ? 'system'
                : 'customer',
            timestamp: m.timestamp
              ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: (m.status?.toLowerCase() as any) || 'sent',
          }));
          await setCachedCustomerChat(bookingIdOrTripId, mapped);
          return mapped;
        }
      }
    } catch {
      // Try next endpoint or local cache
    }
  }

  return getCachedCustomerChat(bookingIdOrTripId);
};

export const sendChatMessage = async (
  bookingIdOrTripId: string,
  text: string,
  imageUrl?: string
): Promise<CustomerChatMessage> => {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body = JSON.stringify({ text, ...(imageUrl ? { imageUrl } : {}) });

  const endpoints = [
    buildPaymentsUrl(env.paymentsApiBaseUrl, `/bookings/${encodeURIComponent(bookingIdOrTripId)}/chat/messages`),
    buildPaymentsUrl(env.paymentsApiBaseUrl, `/trips/${encodeURIComponent(bookingIdOrTripId)}/chat/messages`),
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body });
      if (res.ok) {
        const data = await res.json();
        const sent: CustomerChatMessage = {
          id: data.id || `msg-${Date.now()}`,
          text: data.text || text,
          imageUrl: data.imageUrl || imageUrl,
          sender: 'customer',
          timestamp: data.timestamp
            ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'sent',
        };
        const cached = await getCachedCustomerChat(bookingIdOrTripId);
        cached.push(sent);
        await setCachedCustomerChat(bookingIdOrTripId, cached);
        return sent;
      }
    } catch {
      // Try next endpoint
    }
  }

  // Fallback save locally
  const fallback: CustomerChatMessage = {
    id: `local-${Date.now()}`,
    text,
    imageUrl,
    sender: 'customer',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    status: 'sent',
  };
  const cached = await getCachedCustomerChat(bookingIdOrTripId);
  cached.push(fallback);
  await setCachedCustomerChat(bookingIdOrTripId, cached);
  return fallback;
};

export const markCustomerChatRead = async (bookingIdOrTripId: string): Promise<void> => {
  const token = await getAuthToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const endpoints = [
    buildPaymentsUrl(env.paymentsApiBaseUrl, `/bookings/${encodeURIComponent(bookingIdOrTripId)}/chat/read`),
    buildPaymentsUrl(env.paymentsApiBaseUrl, `/trips/${encodeURIComponent(bookingIdOrTripId)}/chat/read`),
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({}) });
      if (res.ok) return;
    } catch {}
  }
};
