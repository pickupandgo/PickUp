import { useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { clearCustomerChatMemory, clearCustomerChatConversation, purgeLegacyCustomerChat } from '../services/chatService';
import type { Trip } from '../api/types';

/** Invisible lifecycle cleanup; no changes to login or the approved Customer layout. */
export function useChatPrivacy(uid: string | null | undefined) {
  useLayoutEffect(() => {
    clearCustomerChatMemory();
    const purge = () => { purgeLegacyCustomerChat().catch(() => undefined); };
    purge();
    const sub = AppState.addEventListener('change', state => { if (state !== 'background' && state !== 'inactive') purge(); else clearCustomerChatMemory(); });
    return () => { sub.remove(); clearCustomerChatMemory(); };
  }, [uid]);
}

export function useChatTripPrivacy(trip?: Trip) {
  const previous = useRef<string | undefined>(undefined);
  const bookingId = trip?.paymentBookingId ?? undefined;
  const ended = trip?.status === 'COMPLETED' || trip?.status === 'CANCELLED';
  useLayoutEffect(() => {
    if (previous.current && previous.current !== bookingId) clearCustomerChatConversation(previous.current);
    if (ended && bookingId) clearCustomerChatConversation(bookingId);
    previous.current = bookingId;
  }, [bookingId, ended]);
}
