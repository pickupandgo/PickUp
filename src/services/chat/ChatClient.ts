import { request } from '../../api/http';

export interface CustomerChatMessage {
  readonly id: string;
  readonly bookingId: string;
  readonly senderId?: string;
  readonly senderRole: 'customer' | 'driver' | 'system';
  readonly text: string;
  readonly imageUrl?: string;
  readonly timestamp: string;
  readonly status: 'sending' | 'sent' | 'delivered' | 'read' | 'error';
  readonly readAt?: string;
}

class ChatClientService {
  // In-memory cache per booking
  private messageCache = new Map<string, CustomerChatMessage[]>();

  /**
   * Fetches message history from backend, falling back to local cache if offline.
   */
  async getMessages(bookingId: string): Promise<CustomerChatMessage[]> {
    try {
      const serverMessages = await request<CustomerChatMessage[]>(
        `/v1/bookings/${bookingId}/chat/messages`,
        { method: 'GET', retries: 1 },
      );

      // Merge server messages with any pending/errored local messages
      const existing = this.messageCache.get(bookingId) || [];
      const pendingLocal = existing.filter(
        (m) => m.status === 'sending' || m.status === 'error',
      );

      const combined = [...serverMessages, ...pendingLocal].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );

      this.messageCache.set(bookingId, combined);
      return combined;
    } catch {
      // Fallback to cache if server is offline or in mock environment
      return this.messageCache.get(bookingId) || [];
    }
  }

  /**
   * Sends a message with optimistic UI update, tracking delivery and error status.
   */
  async sendMessage(
    bookingId: string,
    text: string,
    onOptimisticUpdate?: (msg: CustomerChatMessage) => void,
  ): Promise<CustomerChatMessage> {
    const tempId = `local-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const optimisticMsg: CustomerChatMessage = {
      id: tempId,
      bookingId,
      senderRole: 'customer',
      text,
      timestamp: now,
      status: 'sending',
    };

    // Store in cache
    const current = this.messageCache.get(bookingId) || [];
    this.messageCache.set(bookingId, [...current, optimisticMsg]);
    onOptimisticUpdate?.(optimisticMsg);

    try {
      const confirmed = await request<CustomerChatMessage>(
        `/v1/bookings/${bookingId}/chat/messages`,
        {
          method: 'POST',
          body: { text },
          retries: 2,
        },
      );

      // Replace optimistic message with confirmed server message
      const updated = (this.messageCache.get(bookingId) || []).map((m) =>
        m.id === tempId ? { ...confirmed, status: 'sent' as const } : m,
      );
      this.messageCache.set(bookingId, updated);
      return confirmed;
    } catch {
      // Mark optimistic message as errored for retry
      const errored: CustomerChatMessage = {
        ...optimisticMsg,
        status: 'error',
      };
      const updated = (this.messageCache.get(bookingId) || []).map((m) =>
        m.id === tempId ? errored : m,
      );
      this.messageCache.set(bookingId, updated);
      throw new Error('Failed to send message');
    }
  }

  /**
   * Retries an errored message.
   */
  async retryMessage(
    bookingId: string,
    failedMsg: CustomerChatMessage,
  ): Promise<CustomerChatMessage> {
    // Remove old failed message
    const current = (this.messageCache.get(bookingId) || []).filter(
      (m) => m.id !== failedMsg.id,
    );
    this.messageCache.set(bookingId, current);

    // Re-send
    return this.sendMessage(bookingId, failedMsg.text);
  }

  /**
   * Marks unread messages as read.
   */
  async markAsRead(bookingId: string): Promise<void> {
    try {
      await request(`/v1/bookings/${bookingId}/chat/read`, {
        method: 'POST',
        retries: 0,
      });
    } catch {
      // Non-fatal
    }
  }

  /**
   * Starts periodic polling for new messages when Socket.IO is reconnecting or polling fallback.
   */
  startPolling(
    bookingId: string,
    intervalMs: number = 3500,
    onUpdate: (messages: CustomerChatMessage[]) => void,
  ): () => void {
    let active = true;

    const poll = async () => {
      if (!active) return;
      try {
        const messages = await this.getMessages(bookingId);
        if (active) onUpdate(messages);
      } catch {
        // Suppress polling error
      }
    };

    poll();
    const timer = setInterval(poll, intervalMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }
}

export const chatClient = new ChatClientService();
