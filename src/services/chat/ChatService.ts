import { ApiClient } from '../api/ApiClient';
import { env } from '../../config/env';
import type { ChatMessage } from '../../types/chat';
import { mockChatMessages } from '../../data/mockData';

export interface IChatService {
  getMessages(tripId: string): Promise<ChatMessage[]>;
  sendMessage(tripId: string, text: string): Promise<ChatMessage>;
  markAsRead(tripId: string): Promise<void>;
}

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export class MockChatService implements IChatService {
  private messages = [...mockChatMessages];

  async getMessages(_tripId: string): Promise<ChatMessage[]> {
    await delay(300);
    return [...this.messages];
  }

  async sendMessage(_tripId: string, text: string): Promise<ChatMessage> {
    await delay(200);
    const msg: ChatMessage = {
      id: `msg-${Date.now()}`,
      text,
      sender: 'driver',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
    };
    this.messages.push(msg);
    return msg;
  }

  async markAsRead(_tripId: string): Promise<void> {
    await delay(100);
  }
}

export class ApiChatService implements IChatService {
  private client = ApiClient.getInstance();

  async getMessages(tripId: string): Promise<ChatMessage[]> {
    try {
      const list = await this.client.get<any[]>(`/v1/trips/${tripId}/chat/messages`);
      return (list || []).map((m) => ({
        id: m.id,
        text: m.text,
        imageUrl: m.imageUrl,
        sender: m.senderRole === 'CUSTOMER' || m.sender === 'rider' ? 'rider' : 'driver',
        timestamp: m.timestamp || m.createdAt || new Date().toISOString(),
        status: (m.status?.toLowerCase() as any) || 'sent',
      }));
    } catch {
      try {
        const list = await this.client.get<any[]>(`/chat/${tripId}/messages`);
        return (list || []).map((m) => ({
          id: m.id,
          text: m.text,
          imageUrl: m.imageUrl,
          sender: m.senderRole === 'CUSTOMER' || m.sender === 'rider' ? 'rider' : 'driver',
          timestamp: m.timestamp || m.createdAt || new Date().toISOString(),
          status: (m.status?.toLowerCase() as any) || 'sent',
        }));
      } catch {
        return [];
      }
    }
  }

  async sendMessage(tripId: string, text: string): Promise<ChatMessage> {
    try {
      const res = await this.client.post<any>(
        `/v1/trips/${tripId}/chat/messages`,
        { text },
        { retryable: true },
      );
      return {
        id: res.id,
        text: res.text,
        imageUrl: res.imageUrl,
        sender: 'driver',
        timestamp: res.timestamp || new Date().toISOString(),
        status: 'sent',
      };
    } catch {
      const res = await this.client.post<any>(
        `/chat/${tripId}/messages`,
        { text },
        { retryable: true },
      );
      return {
        id: res.id,
        text: res.text,
        imageUrl: res.imageUrl,
        sender: 'driver',
        timestamp: res.timestamp || new Date().toISOString(),
        status: 'sent',
      };
    }
  }

  async markAsRead(tripId: string): Promise<void> {
    try {
      await this.client.post(`/v1/trips/${tripId}/chat/read`, {}, { retryable: false });
    } catch {
      try {
        await this.client.post(`/chat/${tripId}/read`, {}, { retryable: false });
      } catch {
        // Non-fatal
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