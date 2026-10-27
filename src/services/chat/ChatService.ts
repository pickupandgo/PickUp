import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import { env } from '../../config/env';
import type { ChatMessage } from '../../types/chat';
import { mockChatMessages } from '../../data/mockData';

export interface IChatService {
  getMessages(tripId: string): Promise<ChatMessage[]>;
  sendMessage(tripId: string, text: string, imageUrl?: string): Promise<ChatMessage>;
  markAsRead(tripId: string): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

const getCacheKey = (tripId: string) => `driver.chat.${tripId}`;

const loadCached = async (tripId: string): Promise<ChatMessage[]> => {
  try {
    const raw = await AsyncStorage.getItem(getCacheKey(tripId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

const saveCached = async (tripId: string, messages: ChatMessage[]): Promise<void> => {
  try {
    await AsyncStorage.setItem(getCacheKey(tripId), JSON.stringify(messages));
  } catch {}
};

export class MockChatService implements IChatService {
  private messagesByTrip = new Map<string, ChatMessage[]>();

  async getMessages(tripId: string): Promise<ChatMessage[]> {
    await delay(200);
    const cached = await loadCached(tripId);
    if (!this.messagesByTrip.has(tripId)) {
      this.messagesByTrip.set(tripId, cached.length > 0 ? cached : [...mockChatMessages]);
    }
    return [...(this.messagesByTrip.get(tripId) ?? [])];
  }

  async sendMessage(tripId: string, text: string, imageUrl?: string): Promise<ChatMessage> {
    await delay(150);
    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      text,
      imageUrl,
      sender: 'driver',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
    };
    const current = this.messagesByTrip.get(tripId) ?? [];
    current.push(msg);
    this.messagesByTrip.set(tripId, current);
    await saveCached(tripId, current);
    return msg;
  }

  async markAsRead(_tripId: string): Promise<void> {
    await delay(50);
  }
}

export class ApiChatService implements IChatService {
  private getBackendUrl(path: string): string {
    const raw = env.PAYMENTS_API_BASE_URL || 'https://pickup-backend-engine-v2.onrender.com';
    const base = raw.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    const baseHasV1 = base.endsWith('/v1');
    const pathHasV1 = cleanPath.startsWith('/v1/');
    if (baseHasV1 && pathHasV1) return `${base}${cleanPath.slice(3)}`;
    if (!baseHasV1 && !pathHasV1) return `${base}/v1${cleanPath}`;
    return `${base}${cleanPath}`;
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      const user = getAuth().currentUser;
      if (user) {
        return await user.getIdToken();
      }
    } catch (err) {
      console.warn('[CHAT] Failed to obtain Firebase ID token', err);
    }
    return null;
  }

  async getMessages(tripId: string): Promise<ChatMessage[]> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const endpoints = [
      this.getBackendUrl(`/v1/trips/${encodeURIComponent(tripId)}/chat/messages`),
      this.getBackendUrl(`/v1/bookings/${encodeURIComponent(tripId)}/chat/messages`),
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { method: 'GET', headers });
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            const mapped: ChatMessage[] = list.map((m: any) => ({
              id: m.id || `msg-${Date.now()}`,
              text: m.text,
              imageUrl: m.imageUrl || undefined,
              sender:
                m.senderRole === 'CUSTOMER' || m.sender === 'rider' || m.sender === 'customer'
                  ? 'rider'
                  : m.senderRole === 'SYSTEM' || m.sender === 'system'
                  ? 'system'
                  : 'driver',
              timestamp: m.timestamp
                ? new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              status: (m.status?.toLowerCase() as any) || 'sent',
            }));
            await saveCached(tripId, mapped);
            return mapped;
          }
        }
      } catch {
        // Try fallback endpoint or cache
      }
    }

    return loadCached(tripId);
  }

  async sendMessage(tripId: string, text: string, imageUrl?: string): Promise<ChatMessage> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const body = JSON.stringify({ text, ...(imageUrl ? { imageUrl } : {}) });

    const endpoints = [
      this.getBackendUrl(`/v1/trips/${encodeURIComponent(tripId)}/chat/messages`),
      this.getBackendUrl(`/v1/bookings/${encodeURIComponent(tripId)}/chat/messages`),
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body });
        if (res.ok) {
          const data = await res.json();
          const sent: ChatMessage = {
            id: data.id || `msg-${Date.now()}`,
            text: data.text || text,
            imageUrl: data.imageUrl || imageUrl,
            sender: 'driver',
            timestamp: data.timestamp
              ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'sent',
          };
          const cached = await loadCached(tripId);
          cached.push(sent);
          await saveCached(tripId, cached);
          return sent;
        }
      } catch {
        // Try next endpoint or local save
      }
    }

    // Local fallback for offline/disconnected
    const fallback: ChatMessage = {
      id: `local-${Date.now()}`,
      text,
      imageUrl,
      sender: 'driver',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
    };
    const cached = await loadCached(tripId);
    cached.push(fallback);
    await saveCached(tripId, cached);
    return fallback;
  }

  async markAsRead(tripId: string): Promise<void> {
    const token = await this.getAuthToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const endpoints = [
      this.getBackendUrl(`/v1/trips/${encodeURIComponent(tripId)}/chat/read`),
      this.getBackendUrl(`/v1/bookings/${encodeURIComponent(tripId)}/chat/read`),
    ];

    for (const url of endpoints) {
      try {
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({}) });
        if (res.ok) return;
      } catch {
        // Ignore read receipts failure
      }
    }
  }
}

export class ChatService {
  private static instance: IChatService;

  static getInstance(): IChatService {
    if (!ChatService.instance) {
      ChatService.instance = env.IS_MOCK_MODE ? new MockChatService() : new ApiChatService();
    }
    return ChatService.instance;
  }
}