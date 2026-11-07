import React, { createContext, useContext, useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBooking } from './BookingContext';
import { useSession } from './SessionContext';
import { fetchChatMessages } from '../services/chatService';

import { colors, spacing, borderRadius } from '../theme';

const Context = createContext({ unread: false, setOpen: (_id?: string) => {} });
export const useChatNotifications = () => useContext(Context);

/** Foreground-only active-trip alerts. No message content is persisted. */
export function ChatNotifications({ children, onOpen }: { children: React.ReactNode; onOpen: (id: string) => void }) {
  const { trip } = useBooking();
  const { authUid } = useSession();
  const id = trip && !['COMPLETED', 'CANCELLED'].includes(trip.status) ? trip.paymentBookingId : undefined;
  const [open, setOpen] = useState<string>();
  const [unreadId, setUnreadId] = useState<string>();
  const [banner, setBanner] = useState(false);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      setActive(state === 'active');
      if (state !== 'active') { setBanner(false); setUnreadId(undefined); }
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    setUnreadId(undefined); setBanner(false);
    if (!id || !authUid || !active || open === id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastMessage: string | undefined;
    const poll = async () => {
      try {
        const messages = await fetchChatMessages(id, controller.signal);
        if (controller.signal.aborted) return;
        const incoming = messages.filter(message => message.sender === 'driver' && ['sent', 'delivered'].includes(message.status));
        setUnreadId(incoming.length ? id : undefined);
        const newest = incoming[incoming.length - 1];
        if (newest && newest.id !== lastMessage) { lastMessage = newest.id; setBanner(true); }
      } catch { /* Keep transport errors out of the chat notification UI. */ }
      finally { if (!controller.signal.aborted) timer = setTimeout(poll, 5000); }
    };
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [id, authUid, active, open]);
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(false), 6000);
    return () => clearTimeout(timer);
  }, [banner]);
  const unread = !!id && unreadId === id && open !== id && active;
  return <Context.Provider value={{ unread, setOpen }}>
    <View style={styles.root}>{children}
      {banner && unread && <View style={[styles.banner, { top: insets.top + spacing.sm }]}>
        <Pressable style={styles.content} accessibilityRole="button" accessibilityLabel="Open driver message" onPress={() => {
          if (!id) return;
          setBanner(false);
          onOpen(id);
        }}><Text style={styles.title}>New message from your driver</Text><Text style={styles.subtitle}>Tap to open chat</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message notification" onPress={() => setBanner(false)} style={styles.close}><Text style={styles.title}>×</Text></Pressable>
      </View>}
    </View>
  </Context.Provider>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: { position: 'absolute', left: spacing.md, right: spacing.md, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.homeAction, borderRadius: borderRadius.lg, elevation: 8, zIndex: 100 },
  content: { flex: 1, padding: spacing.md },
  title: { color: colors.onPrimary, fontWeight: '700' },
  subtitle: { color: colors.onPrimary, marginTop: spacing.xs },
  close: { padding: spacing.md },
});
