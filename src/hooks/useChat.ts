import { useState, useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import {
  ChatService,
  ChatError,
  conversationKey,
  newChatMessageId,
  type ChatConversation,
} from '../services/chat/ChatService';
import type { ChatMessage } from '../types/chat';
import { chatNotificationSignals } from '../services/notifications/ChatNotificationSignals';

export function useChat(conversation?: ChatConversation, ended = false) {
  const [uid, setUid] = useState(getAuth().currentUser?.uid);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const key = `${uid ?? ''}:${
    conversation ? conversationKey(conversation) : ''
  }`;
  const [state, setState] = useState<{
    key: string;
    messages: ChatMessage[];
    loading: boolean;
    error: string | null;
    closed: boolean;
    allowed: boolean;
  }>({
    key,
    messages: [],
    loading: false,
    error: null,
    closed: false,
    allowed: false,
  });
  const [revision, setRevision] = useState(0);
  const scope = useRef(0);
  const sending = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const kind = conversation?.kind,
    id = conversation?.id;
  useEffect(
    () =>
      onAuthStateChanged(getAuth(), () => setUid(getAuth().currentUser?.uid)),
    [],
  );
  useEffect(
    () =>
      ChatService.getInstance().subscribePrivacy(() => {
        setState(previous => ({
          ...previous,
          messages: [],
          allowed: false,
          loading: false,
        }));
      }),
    [],
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', value =>
      setActive(value === 'active'),
    );
    return () => sub.remove();
  }, []);
  const close = useCallback(
    (error: string) => {
      ++scope.current;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      if (kind && id) ChatService.getInstance().forget({ kind, id });
      setState({
        key,
        messages: [],
        loading: false,
        error,
        closed: true,
        allowed: false,
      });
    },
    [key, kind, id],
  );
  useEffect(() => {
    if (ended) close('This trip has ended. Chat is closed.');
  }, [ended, close]);

  useFocusEffect(
    useCallback(() => {
      const epoch = ++scope.current;
      const current = () =>
        scope.current === epoch && getAuth().currentUser?.uid === uid;
      const pending = controllers.current;
      sending.current = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let first = true;
      if (!uid || !active || !kind || !id || ended) return;
      const ref: ChatConversation = { kind, id };
      const stopViewing = chatNotificationSignals.viewing(ref, uid);
      const controller = new AbortController();
      pending.add(controller);
      const load = async () => {
        let stop = false;
        if (first)
          setState(previous =>
            previous.key === key
              ? {
                  ...previous,
                  loading: previous.messages.length === 0,
                  error: revision > 0 ? null : previous.error,
                }
              : {
                  key,
                  messages: [],
                  loading: true,
                  error: null,
                  closed: false,
                  allowed: false,
                },
          );
        first = false;
        try {
          const messages = await ChatService.getInstance().getMessages(
            ref,
            controller.signal,
          );
          if (!current()) return;
          setState({
            key,
            messages,
            error: null,
            loading: false,
            closed: false,
            allowed: true,
          });
          if (
            messages.some(
              message =>
                message.sender !== 'driver' &&
                ['sent', 'delivered'].includes(message.status),
            )
          ) {
            await ChatService.getInstance().markAsRead(ref, controller.signal);
          } else chatNotificationSignals.read(ref, uid, false);
        } catch (error) {
          if (!current() || controller.signal.aborted) return;
          const message =
            error instanceof Error ? error.message : 'Could not refresh chat.';
          if (
            error instanceof ChatError &&
            [401, 403, 410].includes(error.status)
          ) {
            stop = true;
            close(message);
          } else
            setState(previous =>
              previous.key === key
                ? {
                    ...previous,
                    loading: false,
                    error: message,
                    allowed:
                      error instanceof ChatError && error.status === 409
                        ? false
                        : previous.allowed,
                  }
                : {
                    key,
                    messages: [],
                    loading: false,
                    error: message,
                    closed: false,
                    allowed: false,
                  },
            );
        } finally {
          if (current() && !stop && !controller.signal.aborted)
            timer = setTimeout(() => {
              load().catch(() => undefined);
            }, 3500);
        }
      };
      load().catch(() => undefined);
      return () => {
        stopViewing();
        ++scope.current;
        if (timer) clearTimeout(timer);
        for (const item of pending) item.abort();
        pending.clear();
        ChatService.getInstance().forget(ref);
        setState({
          key,
          messages: [],
          loading: false,
          error: null,
          closed: false,
          allowed: false,
        });
        sending.current = false;
      };
    }, [uid, active, kind, id, ended, key, revision, close]),
  );

  const transmit = useCallback(
    async (message: ChatMessage) => {
      if (
        !uid ||
        !active ||
        !kind ||
        !id ||
        ended ||
        sending.current ||
        !message.clientMessageId
      )
        return false;
      const epoch = scope.current;
      const current = () =>
        epoch === scope.current && getAuth().currentUser?.uid === uid;
      const controller = new AbortController();
      controllers.current.add(controller);
      sending.current = true;
      setState(previous => ({
        ...previous,
        key,
        messages: [
          ...(previous.key === key ? previous.messages : []).filter(
            item => item.clientMessageId !== message.clientMessageId,
          ),
          { ...message, status: 'sending' },
        ],
      }));
      try {
        const confirmed = await ChatService.getInstance().sendMessage(
          { kind, id },
          message.text ?? '',
          message.clientMessageId,
          controller.signal,
        );
        if (current())
          setState(previous => ({
            ...previous,
            error: null,
            messages: [
              ...previous.messages.filter(
                item =>
                  item.clientMessageId !== confirmed.clientMessageId &&
                  item.id !== confirmed.id,
              ),
              confirmed,
            ],
          }));
        return true;
      } catch (error) {
        if (current() && !controller.signal.aborted) {
          const reason =
            error instanceof Error
              ? error.message
              : 'Message was not confirmed. Retry.';
          if (
            error instanceof ChatError &&
            [401, 403, 410].includes(error.status)
          )
            close(reason);
          else
            setState(previous => ({
              ...previous,
              error: reason,
              messages: previous.messages.map(item =>
                item.clientMessageId === message.clientMessageId
                  ? { ...item, status: 'error' }
                  : item,
              ),
            }));
        }
        return false;
      } finally {
        controllers.current.delete(controller);
        if (current()) sending.current = false;
      }
    },
    [uid, active, kind, id, ended, key, close],
  );
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || text.trim().length > 2000) return false;
      const clientMessageId = newChatMessageId();
      return transmit({
        id: `local:${clientMessageId}`,
        clientMessageId,
        text: text.trim(),
        sender: 'driver',
        timestamp: new Date().toISOString(),
        status: 'sending',
      });
    },
    [transmit],
  );
  const visible =
    state.key === key
      ? state
      : {
          key,
          messages: [],
          loading: false,
          error: null,
          closed: false,
          allowed: false,
        };
  return {
    messages: ended ? [] : visible.messages,
    isLoading: visible.loading,
    error: visible.error,
    closed: ended || visible.closed,
    ready:
      !!uid &&
      !!kind &&
      !!id &&
      active &&
      !ended &&
      !visible.closed &&
      visible.allowed,
    sendMessage,
    retryMessage: transmit,
    fetchMessages: () => setRevision(value => value + 1),
  };
}
