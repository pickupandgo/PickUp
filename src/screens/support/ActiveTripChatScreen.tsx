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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useBooking } from '../../state/BookingContext';
import { getVehicleImage } from '../../utils/vehicleAssets';
import {
  fetchChatMessages,
  sendChatMessage,
  markCustomerChatRead,
  getCachedCustomerChat,
  type CustomerChatMessage,
} from '../../services/chatService';

export interface ActiveTripChatScreenProps {
  readonly onBack?: () => void;
  readonly onNotifications?: () => void;
  readonly onAttachFile?: () => void;
}

const ActiveTripChatScreen: React.FC<ActiveTripChatScreenProps & { navigation?: any; route?: any }> = ({
  onBack,
  onNotifications,
  onAttachFile,
  navigation,
  route,
}) => {
  const { assignedDriver, trip, ride, draft } = useBooking();
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<CustomerChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);
  const isMountedRef = useRef(true);

  const conversationId = useMemo(() => {
    return (
      route?.params?.tripId ||
      route?.params?.bookingId ||
      trip?.paymentBookingId ||
      ride?.paymentBookingId ||
      trip?.id ||
      ride?.id ||
      'active-trip'
    );
  }, [route?.params, trip, ride]);

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
    'Mini Truck';

  const driverRating =
    (assignedDriver as any)?.rating != null
      ? Number((assignedDriver as any).rating).toFixed(1)
      : '4.9';

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

  // Load cached messages immediately on mount
  useEffect(() => {
    isMountedRef.current = true;
    getCachedCustomerChat(conversationId).then((cached) => {
      if (isMountedRef.current && cached.length > 0) {
        setMessages(cached);
      }
    });

    return () => {
      isMountedRef.current = false;
    };
  }, [conversationId]);

  // Polling for live chat messages
  const loadMessages = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const remote = await fetchChatMessages(conversationId);
        if (isMountedRef.current) {
          setMessages((prev) => {
            const localPending = prev.filter((m) => m.status === 'sending' || m.status === 'error');
            const remoteIds = new Set(remote.map((r) => r.id));
            const remaining = localPending.filter((m) => !remoteIds.has(m.id));
            return [...remote, ...remaining];
          });
        }
      } catch {
        // Fall back to current/cached messages
      } finally {
        if (isMountedRef.current && !silent) {
          setIsLoading(false);
        }
      }
    },
    [conversationId]
  );

  useEffect(() => {
    loadMessages(false);
    markCustomerChatRead(conversationId);

    const interval = setInterval(() => {
      loadMessages(true);
    }, 3500);

    return () => clearInterval(interval);
  }, [loadMessages, conversationId]);

  const handleSend = async () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;

    setInputText('');

    const tempId = `temp-${Date.now()}`;
    const tempMsg: CustomerChatMessage = {
      id: tempId,
      text: trimmed,
      sender: 'customer',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sending',
    };

    setMessages((prev) => [...prev, tempMsg]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const confirmed = await sendChatMessage(conversationId, trimmed);
      if (isMountedRef.current) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? confirmed : m)));
      }
    } catch {
      if (isMountedRef.current) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, status: 'error' as const } : m))
        );
      }
    }
  };

  const handleAttachment = () => {
    if (onAttachFile) {
      onAttachFile();
      return;
    }
    Alert.alert(
      'Photo Attachment',
      'Select a photo from your gallery or take a picture to send to the driver.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send Warehouse Gate Photo',
          onPress: async () => {
            const sampleUrl =
              'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&auto=format&fit=crop&q=80';
            const tempId = `temp-img-${Date.now()}`;
            const tempMsg: CustomerChatMessage = {
              id: tempId,
              text: 'Warehouse Entrance & Loading Bay',
              imageUrl: sampleUrl,
              sender: 'customer',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              status: 'sending',
            };
            setMessages((prev) => [...prev, tempMsg]);
            setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
            const confirmed = await sendChatMessage(conversationId, 'Warehouse Entrance & Loading Bay', sampleUrl);
            setMessages((prev) => prev.map((m) => (m.id === tempId ? confirmed : m)));
          },
        },
      ]
    );
  };

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
                    <View style={styles.messageMetaRight}>
                      <Text style={styles.timeText}>{item.timestamp}</Text>
                      <Feather
                        name={item.status === 'sending' ? 'clock' : 'check'}
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
                  <Text style={styles.timeText}>{item.timestamp}</Text>
                </View>
              );
            })
          )}
        </ScrollView>

        {/* Input Bar */}
        <View style={styles.inputContainer}>
          <Pressable
            style={styles.clipButton}
            onPress={handleAttachment}
            accessibilityRole="button"
            accessibilityLabel="Attach photo"
          >
            <Feather name="paperclip" size={20} color="#64748B" />
          </Pressable>

          <TextInput
            style={styles.input}
            placeholder={`Message ${driverName}...`}
            placeholderTextColor="#94A3B8"
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />

          <Pressable
            style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!inputText.trim()}
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

export default ActiveTripChatScreen;
