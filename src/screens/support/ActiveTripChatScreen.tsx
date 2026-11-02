import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  ActivityIndicator,
  Alert, AppState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { getAuth } from '@react-native-firebase/auth';
import { useFocusEffect } from '@react-navigation/native';
import type { Trip } from '../../api/types';
import { toApiError } from '../../api/http';
import { useSelectedTrip } from '../../hooks/useSelectedTrip';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useBooking } from '../../state/BookingContext';
import { getVehicleImage } from '../../utils/vehicleAssets';
import {
  fetchChatMessages,
  sendChatMessage,
  markCustomerChatRead,
  clearCustomerChatConversation, newChatMessageId,
  type CustomerChatMessage,
} from '../../services/chatService';

export interface ActiveTripChatScreenProps {
  readonly onBack?: () => void;
  readonly onNotifications?: () => void;
  readonly onAttachFile?: () => void;
}

const ConversationChatScreen: React.FC<ActiveTripChatScreenProps & { navigation?: any; route?: any; resolvedTrip?: Trip; conversationId?: string; conversationEnded?: boolean }> = ({
  onBack,
  onNotifications,
  onAttachFile,
  navigation,
  route, resolvedTrip, conversationId, conversationEnded,
}) => {
  const context = useBooking();
  const trip = resolvedTrip;
  const explicit = !!route?.params && ('tripId' in route.params || 'trip' in route.params || 'bookingId' in route.params);
  const scoped = !explicit || (!!trip && trip.id === context.trip?.id);
  const assignedDriver = scoped ? context.assignedDriver : undefined;
  const ride = scoped ? context.ride : undefined;
  const draft = scoped ? context.draft : { drops: [] } as typeof context.draft;
  const [inputText, setInputText] = useState('');
  const [chatClosed, setChatClosed] = useState(!!conversationEnded);
  const [confirmedActive, setConfirmedActive] = useState(false);
  const [messages, setMessages] = useState<CustomerChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const isMountedRef = useRef(true);

  const [loadError, setLoadError] = useState<string>();
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const sending = useRef(false);
  const sendControllers = useRef(new Set<AbortController>());
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {
      setFocused(false); setMessages([]); setInputText(''); setConfirmedActive(false);
      sendControllers.current.forEach(controller => controller.abort());
      if (conversationId) clearCustomerChatConversation(conversationId);
    };
  }, [conversationId]));
  useEffect(() => { const sub = AppState.addEventListener('change', state => {
    const active = state !== 'background' && state !== 'inactive'; setAppActive(active);
    if (!active) { setMessages([]); setInputText(''); setConfirmedActive(false); sendControllers.current.forEach(controller => controller.abort()); }
  }); return () => sub.remove(); }, []);

  const driverName =
    route?.params?.driverName ||
    assignedDriver?.name ||
    (trip as any)?.driverName ||
    (trip as any)?.driver?.name ||
    'Driver';

  const vehicleInfo =
    route?.params?.vehicleType ||
    assignedDriver?.vehicleType ||
    (trip as any)?.vehicleType ||
    ride?.vehicleType ||
    draft?.vehicleType ||
    'Not available';

  const driverRating =
    (assignedDriver as any)?.rating != null
      ? Number((assignedDriver as any).rating).toFixed(1)
      : 'Not available';

  const tripBannerText =
    trip?.status === 'DRIVER_ARRIVED'
      ? 'Driver arrived at pickup location'
      : trip?.status === 'PICKUP_VERIFIED'
      ? 'Pickup confirmed, heading to drop'
      : trip?.status === 'IN_TRANSIT'
      ? 'En route to Delivery Location'
      : trip?.status === 'DROP_PROGRESS'
      ? 'Out for delivery'
      : 'Live Trip in Progress';

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; sendControllers.current.forEach(controller => controller.abort()); };
  }, []);

  useEffect(() => {
    if (!conversationId || !appActive || !focused) return;
    const controller = new AbortController();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setIsLoading(true);
    setMessages([]); setConfirmedActive(false);
    const load = async () => {
      try {
        const remote = await fetchChatMessages(conversationId, controller.signal);
        if (disposed) return;
        if (remote.some(message => message.sender !== 'customer' && ['sent','delivered'].includes(message.status))) await markCustomerChatRead(conversationId, controller.signal);
        if (disposed) return;
        setMessages(remote); setLoadError(undefined); setConfirmedActive(true);
      } catch (error) { if (!disposed) { const failure = toApiError(error); if ([401,403,410].includes(failure.status ?? 0)) { setMessages([]); setInputText(''); setConfirmedActive(false); setChatClosed(true); clearCustomerChatConversation(conversationId); controller.abort(); } setLoadError(failure.status === 410 ? 'This trip has ended. Chat is closed.' : failure.userMessage); } }
      finally {
        if (!disposed) { setIsLoading(false); if (!controller.signal.aborted) timer = setTimeout(() => { void load(); }, 3500); }
      }
    };
    void load();
    return () => { disposed = true; controller.abort(); if (timer) clearTimeout(timer); };
  }, [conversationId, appActive, focused]);

  const transmit = async (message: CustomerChatMessage) => {
    if (!conversationId || !appActive || !focused || chatClosed || !confirmedActive || !message.clientMessageId) return;
    const controller = new AbortController(); sendControllers.current.add(controller);
    setMessages(previous => previous.map(item => item.clientMessageId === message.clientMessageId ? { ...item, status: 'sending' } : item));
    try {
      const confirmed = await sendChatMessage(conversationId, message.text ?? '', message.imageUrl, message.clientMessageId, controller.signal);
      if (isMountedRef.current && !controller.signal.aborted) setMessages(previous => [...previous.filter(item => item.clientMessageId !== message.clientMessageId && item.id !== confirmed.id), confirmed]);
    } catch (error) {
      if (isMountedRef.current && !controller.signal.aborted) {
        const failure = toApiError(error);
        if ([401,403,410].includes(failure.status ?? 0)) { setMessages([]); setInputText(''); setChatClosed(true); setConfirmedActive(false); clearCustomerChatConversation(conversationId); setLoadError('This chat is no longer available.'); return; }
        setMessages(previous => previous.map(item => item.clientMessageId === message.clientMessageId ? { ...item, status: 'error' } : item));
        setLoadError(toApiError(error).userMessage);
      }
    } finally { sendControllers.current.delete(controller); }
  };
  const handleSend = async () => {
    if (sending.current || !conversationId || !appActive || !focused || chatClosed || !confirmedActive || isLoading || !inputText.trim()) return;
    sending.current = true;
    const clientMessageId = newChatMessageId();
    const message: CustomerChatMessage = { id: `local:${clientMessageId}`, clientMessageId, text: inputText.trim(), sender: 'customer', timestamp: new Date().toISOString(), status: 'sending' };
    setInputText(''); setMessages(previous => [...previous, message]);
    try { await transmit(message); } finally { sending.current = false; }
  };
  const handleAttachment = () => onAttachFile?.();
  const displayTime = (raw: string) => Number.isFinite(Date.parse(raw)) ? new Date(raw).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
            accessibilityRole="button"
          >
            <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
          </Pressable>

          <View style={styles.headerCenter}>
            <Text style={styles.driverName} numberOfLines={1}>
              {driverName}
            </Text>
            <View style={styles.driverSubInfo}>
              <Text style={styles.driverSubText}>{vehicleInfo}</Text>
              <View style={styles.dotSeparator} />
              <Feather name="star" size={12} color="#EAB308" />
              <Text style={styles.driverSubText}>{driverRating}</Text>
            </View>
          </View>

          <Pressable
            style={styles.iconButton}
            onPress={() =>
              onNotifications
                ? onNotifications()
                : navigation?.navigate('NotificationCenterScreen')
            }
            accessibilityRole="button"
          >
            <Feather name="bell" size={22} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>

        {/* Trip Context Banner */}
        <View style={styles.tripBanner}>
          <Image
            source={getVehicleImage(vehicleInfo)}
            style={{ width: 20, height: 20, marginRight: 8 }}
            resizeMode="contain"
          />
          <Text style={styles.tripBannerText}>{tripBannerText}</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Chat Canvas */}
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.chatCanvas}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {/* Date Divider */}
          <View style={styles.dateDivider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dateText}>TODAY</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* System Trip Event Pill */}
          {trip?.status === 'DRIVER_ARRIVED' && (
            <View style={styles.systemMessageContainer}>
              <View style={styles.systemMessage}>
                <Feather name="map-pin" size={13} color="#475569" />
                <Text style={styles.systemMessageText}>Driver arrived at Pickup Location</Text>
              </View>
            </View>
          )}

          {(trip?.status === 'IN_TRANSIT' || trip?.status === 'DROP_PROGRESS') && (
            <View style={styles.systemMessageContainer}>
              <View style={styles.systemMessage}>
                <Feather name="navigation" size={13} color="#475569" />
                <Text style={styles.systemMessageText}>
                  En route to Drop: {trip?.drop?.address || draft?.drops?.[0]?.address || 'Destination'}
                </Text>
              </View>
            </View>
          )}

          {isLoading && messages.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptySubtitle}>
                Send a message to coordinate pickup or delivery instructions with {driverName}.
              </Text>
            </View>
          ) : (
            messages.map((item) => {
              if (item.sender === 'system') {
                return (
                  <View key={item.id} style={styles.systemMessageContainer}>
                    <View style={styles.systemMessage}>
                      <Feather name="info" size={13} color="#475569" />
                      <Text style={styles.systemMessageText}>{item.text}</Text>
                    </View>
                  </View>
                );
              }

              const isCustomer = item.sender === 'customer';

              if (isCustomer) {
                return (
                  <View key={item.id} style={styles.messageRowRight}>
                    <View style={styles.messageBubbleRight}>
                      {item.imageUrl ? (
                        <View style={styles.attachmentWrapper}>
                          <Image source={{ uri: item.imageUrl }} style={styles.attachmentImage} />
                          {item.status === 'sending' && (
                            <View style={styles.uploadingOverlay}>
                              <ActivityIndicator size="small" color="#FFFFFF" />
                              <Text style={styles.uploadingText}>Uploading...</Text>
                            </View>
                          )}
                        </View>
                      ) : null}
                      {item.text ? <Text style={styles.messageTextRight}>{item.text}</Text> : null}
                    </View>
                    {item.status === 'error' && <Pressable accessibilityRole="button" accessibilityLabel="Retry message" onPress={() => { void transmit(item); }}><Text style={styles.timeText}>Send not confirmed - Retry</Text></Pressable>}
                    <View style={styles.messageMetaRight}>
                      <Text style={styles.timeText}>{displayTime(item.timestamp)}</Text>
                      <Text style={styles.timeText}>{item.status === 'sending' ? 'Sending...' : item.status === 'error' ? 'Unconfirmed' : item.status === 'read' ? 'Read' : item.status === 'delivered' ? 'Delivered' : 'Sent'}</Text>
                      <Feather
                        name={item.status === 'sending' ? 'clock' : item.status === 'error' ? 'alert-circle' : 'check'}
                        size={12}
                        color={colors.primary}
                      />
                    </View>
                  </View>
                );
              }

              // Driver Message (Left)
              return (
                <View key={item.id} style={styles.messageRowLeft}>
                  <View style={styles.messageBubbleLeft}>
                    {item.imageUrl ? (
                      <View style={styles.attachmentWrapper}>
                        <Image source={{ uri: item.imageUrl }} style={styles.attachmentImage} />
                      </View>
                    ) : null}
                    {item.text ? <Text style={styles.messageTextLeft}>{item.text}</Text> : null}
                  </View>
                  <Text style={styles.timeText}>{displayTime(item.timestamp)}</Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {(!conversationId || loadError || chatClosed) && <Text style={{ color: colors.onSurface, padding: spacing.sm }}>{chatClosed ? 'This trip has ended. Chat is closed.' : !conversationId ? 'Chat is unavailable until driver assignment is confirmed.' : `Could not refresh chat. ${loadError}`}</Text>}
        {/* Input Bar */}
        <View style={styles.inputContainer}>
          <Pressable
            style={styles.clipButton}
            onPress={handleAttachment}
            disabled
            accessibilityRole="button"
            accessibilityLabel="Attach photo"
          >
            <Feather name="paperclip" size={20} color="#64748B" />
          </Pressable>

          <TextInput
            style={styles.input}
            placeholder={`Message ${driverName}...`}
            placeholderTextColor="#94A3B8"
            maxLength={2000}
            editable={!!conversationId && appActive && focused && confirmedActive && !chatClosed}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />

          <Pressable
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim() || !conversationId || !appActive || !focused || isLoading || chatClosed || !confirmedActive}
            accessibilityRole="button"
            accessibilityLabel="Send message"
          >
            <Feather
              name="send"
              size={16}
              color={inputText.trim() ? '#FFFFFF' : '#94A3B8'}
            />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  iconButton: {
    padding: 6,
    borderRadius: 20,
  },
  headerCenter: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 10,
  },
  driverName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  driverSubInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  driverSubText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  dotSeparator: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#94A3B8',
    marginHorizontal: 2,
  },
  tripBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  tripBannerText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  keyboardAvoid: {
    flex: 1,
  },
  chatCanvas: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexGrow: 1,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  dateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
    letterSpacing: 0.8,
  },
  systemMessageContainer: {
    alignItems: 'center',
    marginVertical: 8,
  },
  systemMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  systemMessageText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#475569',
  },
  loadingContainer: {
    paddingVertical: 30,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingVertical: 50,
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
  },
  messageRowLeft: {
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  messageBubbleLeft: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    maxWidth: '80%',
  },
  messageTextLeft: {
    fontSize: 14,
    color: '#0F172A',
    lineHeight: 20,
  },
  messageRowRight: {
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  messageBubbleRight: {
    backgroundColor: '#03071D',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    maxWidth: '80%',
  },
  messageTextRight: {
    fontSize: 14,
    color: '#FFFFFF',
    lineHeight: 20,
  },
  messageMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    marginRight: 4,
  },
  timeText: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 4,
    marginLeft: 4,
  },
  attachmentWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 6,
    width: 220,
    height: 140,
    backgroundColor: '#000000',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  uploadingText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 8,
  },
  clipButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0F172A',
    maxHeight: 90,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#03071D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#F1F5F9',
  },
});

const ActiveTripChatScreen: React.FC<ActiveTripChatScreenProps & { navigation?: any; route?: any }> = props => {
  const context = useBooking();
  const selected = useSelectedTrip(props.route?.params, context.trip);
  const current = context.trip?.id === selected?.id ? context.trip : context.completedBooking?.trip.id === selected?.id ? context.completedBooking?.trip : selected;
  const [focused, setFocused] = useState(false);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const { trip: polled } = useTripStatus(current?.id, { enabled: focused && !!current && !['COMPLETED', 'CANCELLED'].includes(current.status) });
  const trip = polled ?? current;
  useEffect(() => { if (polled && polled.id === context.trip?.id) context.setTrip?.(polled); }, [polled, context.trip?.id, context.setTrip]);
  const params = props.route?.params;
  const explicit = !!params && ('trip' in params || 'tripId' in params || 'bookingId' in params || 'paymentBookingId' in params);
  const bookingId = trip?.paymentBookingId ?? params?.paymentBookingId ?? params?.bookingId ?? (!explicit ? context.ride?.paymentBookingId : undefined);
  const uid = getAuth().currentUser?.uid;
  const ended = !!trip && ['COMPLETED','CANCELLED'].includes(trip.status);
  useEffect(() => { if (ended && bookingId) clearCustomerChatConversation(bookingId); }, [ended,bookingId]);
  return <ConversationChatScreen key={`${uid ?? 'signed-out'}:${bookingId ?? 'unavailable'}:${ended}`} {...props} resolvedTrip={trip} conversationEnded={ended} conversationId={uid && !ended ? bookingId : undefined} />;
};

export default ActiveTripChatScreen;
