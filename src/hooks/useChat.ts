import { useState, useCallback, useEffect, useRef } from 'react';
import { ChatService } from '../services/chat/ChatService';
import type { ChatMessage } from '../types/chat';

export function useChat(tripId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const data = await ChatService.getInstance().getMessages(tripId);
      setMessages((prev) => {
        // Keep pending or error local messages that haven't synced yet
        const localPending = prev.filter((m) => m.status === 'sending' || m.status === 'error');
        const remoteIds = new Set(data.map((d) => d.id));
        const filteredPending = localPending.filter((m) => !remoteIds.has(m.id));
        return [...data, ...filteredPending];
      });
    } catch (err: unknown) {
      if (!silent) {
        setError((err instanceof Error ? err.message : 'Unknown error') || 'Failed to fetch messages');
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    fetchMessages();
    // Poll every 3 seconds for new customer messages
    pollingRef.current = setInterval(() => {
      fetchMessages(true);
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [fetchMessages]);

  const sendMessage = useCallback(async (text: string, imageUrl?: string) => {
    const tempId = `temp-${Date.now()}`;
    const tempMsg: ChatMessage = {
      id: tempId,
      text,
      imageUrl,
      sender: 'driver',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sending',
    };

    setMessages((prev) => [...prev, tempMsg]);

    try {
      const sentMsg = await ChatService.getInstance().sendMessage(tripId, text, imageUrl);
      setMessages((prev) => prev.map((m) => (m.id === tempId ? sentMsg : m)));
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : 'Unknown error') || 'Failed to send message');
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, status: 'error' as const } : m)),
      );
    }
  }, [tripId]);

  const retryMessage = useCallback(async (failedMsg: ChatMessage) => {
    if (!failedMsg.text && !failedMsg.imageUrl) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'sending' as const } : m)),
    );

    try {
      const sentMsg = await ChatService.getInstance().sendMessage(tripId, failedMsg.text ?? '', failedMsg.imageUrl);
      setMessages((prev) => prev.map((m) => (m.id === failedMsg.id ? sentMsg : m)));
    } catch (err: unknown) {
      setMessages((prev) =>
        prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'error' as const } : m)),
      );
    }
  }, [tripId]);

  const markAsRead = useCallback(async () => {
    try {
      await ChatService.getInstance().markAsRead(tripId);
    } catch (err) {
      console.warn('Failed to mark messages as read', err);
    }
  }, [tripId]);

  return { messages, isLoading, error, fetchMessages, sendMessage, retryMessage, markAsRead };
}
