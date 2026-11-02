import { useEffect } from 'react';
import { AppState } from 'react-native';
import { clearCustomerChatMemory, purgeLegacyCustomerChat } from '../services/chatService';
import type { Trip } from '../api/types';

/** Invisible lifecycle cleanup; no changes to login or the approved Customer layout. */
export function useChatPrivacy(uid: string | null | undefined) {
  useEffect(() => {
    clearCustomerChatMemory();
    const purge = () => { purgeLegacyCustomerChat().catch(() => undefined); };
    purge();
    const sub = AppState.addEventListener('change', state => { if (state === 'active') purge(); else clearCustomerChatMemory(); });
    return () => { sub.remove(); clearCustomerChatMemory(); };
  }, [uid]);
}

export function useChatTripPrivacy(trip?: Trip) {
  const ended = trip?.status === 'COMPLETED' || trip?.status === 'CANCELLED';
  useEffect(() => { clearCustomerChatMemory(); }, [trip?.id, ended]);
}
