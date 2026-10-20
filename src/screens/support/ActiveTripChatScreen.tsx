import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useI18n } from '../../i18n';
import { useBooking } from '../../state/BookingContext';
import { chatClient, CustomerChatMessage } from '../../services/chat/ChatClient';

export interface ActiveTripChatScreenProps {
  readonly onBack?: () => void;
  readonly onNotifications?: () => void;
  readonly onAttachFile?: () => void;
}

const ActiveTripChatScreen: React.FC<
  ActiveTripChatScreenProps & { navigation?: any; route?: any }
> = ({ onBack, onNotifications, onAttachFile, navigation, route }) => {
  const { t } = useI18n();
  const { ride, trip, assignedDriver, draft } = useBooking();

  // Resolved bookingId and context
  const bookingId =
    route?.params?.bookingId ||
    trip?.bookingId ||
    ride?.id ||
    'active-booking';

  const driverName =
    route?.params?.driverName ||
    assignedDriver?.name ||
    'Driver';

  const vehicleType =
    route?.params?.vehicleType ||
    assignedDriver?.vehicleType ||
    draft.vehicleType ||
    'Vehicle';

  const [messages, setMessages] = useState<CustomerChatMessage[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const scrollViewRef = useRef<ScrollView>(null);

  // Load message history and subscribe to real-time updates
  useEffect(() => {
    let isMounted = true;

    chatClient
      .getMessages(bookingId)
      .then((data) => {
        if (isMounted) {
          setMessages(data);
          setIsLoading(false);
          chatClient.markAsRead(bookingId);
        }
      })
      .catch(() => {
        if (isMounted) setIsLoading(false);
      });

    // Real-time polling listener
    const unsubscribe = chatClient.startPolling(bookingId, 3000, (updated) => {
      if (isMounted) {
        setMessages(updated);
        chatClient.markAsRead(bookingId);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [bookingId]);

  // Scroll to bottom when messages update
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = messageText.trim();
    if (!trimmed) return;

    setMessageText('');

    try {
      await chatClient.sendMessage(bookingId, trimmed, (optimistic) => {
        setMessages((prev) => [...prev, optimistic]);
      });

      // Refresh messages after server confirmation
      const fresh = await chatClient.getMessages(bookingId);
      setMessages(fresh);
    } catch {
      // Handled via optimistic status update
      const fresh = await chatClient.getMessages(bookingId);
      setMessages(fresh);
    }
  }, [bookingId, messageText]);

  const handleRetry = useCallback(
    async (failedMsg: CustomerChatMessage) => {
      try {
        await chatClient.retryMessage(bookingId, failedMsg);
        const fresh = await chatClient.getMessages(bookingId);
        setMessages(fresh);
      } catch {
        const fresh = await chatClient.getMessages(bookingId);
        setMessages(fresh);
      }
    },
    [bookingId],
  );

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Pressable
              style={styles.iconButton}
              onPress={() => (onBack ? onBack() : navigation?.goBack())}
              accessibilityRole="button"
              accessibilityLabel={t('common.goBack')}
            >
              <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
            </Pressable>

            <View style={styles.headerCenter}>
              <Text style={styles.driverName}>{driverName}</Text>
              <View style={styles.driverSubInfo}>
                <Text style={styles.driverSubText}>{vehicleType}</Text>
                <View style={styles.dotSeparator} />
                <Feather name="star" size={12} color={colors.tertiary} />
                <Text style={styles.driverSubText}>4.9</Text>
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
              accessibilityLabel={t('notifications.title')}
            >
              <Feather name="bell" size={24} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* Active Trip Banner */}
          <View style={styles.tripBanner}>
            <Feather name="truck" size={16} color={colors.secondary} />
            <Text style={styles.tripBannerText}>
              {t('chat.enRouteDrop', { dropNumber: 1, total: 1 })}
            </Text>
          </View>
        </View>

        {/* Loading Indicator */}
        {isLoading ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          /* Messages Canvas */
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={styles.chatCanvas}
            keyboardShouldPersistTaps="handled"
          >
            {/* Date Divider */}
            <View style={styles.dateDivider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dateText}>{t('chat.today')}</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Empty State */}
            {messages.length === 0 ? (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Feather name="message-square" size={32} color={colors.primary} />
                </View>
                <Text style={styles.emptyTitle}>{t('chat.emptyStateTitle')}</Text>
                <Text style={styles.emptySubtitle}>{t('chat.emptyStateSubtitle')}</Text>
              </View>
            ) : (
              messages.map((item) => {
                const isCustomer = item.senderRole === 'customer';

                if (!isCustomer) {
                  // Driver message (Left Bubble)
                  return (
                    <View key={item.id} style={styles.messageRowLeft}>
                      <View style={styles.messageBubbleLeft}>
                        <Text style={styles.messageTextLeft}>{item.text}</Text>
                      </View>
                      <Text style={styles.timeText}>{formatTime(item.timestamp)}</Text>
                    </View>
                  );
                }

                // Customer message (Right Bubble)
                const isSending = item.status === 'sending';
                const isError = item.status === 'error';
                const isRead = item.status === 'read';

                return (
                  <View key={item.id} style={styles.messageRowRight}>
                    <Pressable
                      style={[
                        styles.messageBubbleRight,
                        isError && styles.messageBubbleError,
                      ]}
                      onPress={() => isError && handleRetry(item)}
                      accessibilityRole={isError ? 'button' : undefined}
                    >
                      <Text style={styles.messageTextRight}>{item.text}</Text>
                    </Pressable>

                    <View style={styles.messageMetaRight}>
                      <Text style={styles.timeText}>
                        {isSending ? t('common.sending') : formatTime(item.timestamp)}
                      </Text>

                      {isSending ? (
                        <Feather name="clock" size={14} color={colors.outline} />
                      ) : isError ? (
                        <Pressable
                          style={styles.retryBadge}
                          onPress={() => handleRetry(item)}
                          accessibilityRole="button"
                        >
                          <Feather name="alert-circle" size={14} color={colors.error} />
                          <Text style={styles.retryText}>{t('chat.tapToRetry')}</Text>
                        </Pressable>
                      ) : isRead ? (
                        <Feather name="check-circle" size={14} color={colors.primary} />
                      ) : (
                        <Feather name="check" size={14} color={colors.primary} />
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        )}

        {/* Input Bar */}
        <View style={styles.inputArea}>
          <Pressable
            style={styles.attachButton}
            onPress={() => onAttachFile?.()}
            accessibilityRole="button"
          >
            <Feather name="paperclip" size={24} color={colors.onSurfaceVariant} />
          </Pressable>

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder={t('chat.messageDriverPlaceholder', {
                name: driverName?.split(' ')[0] || driverName,
              })}
              placeholderTextColor={colors.onSurfaceVariant + 'B3'}
              value={messageText}
              onChangeText={setMessageText}
              multiline
              accessibilityLabel={t('chat.messageDriverPlaceholder', {
                name: driverName?.split(' ')[0] || driverName,
              })}
            />
          </View>

          <Pressable
            style={[
              styles.sendButton,
              !messageText.trim() && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!messageText.trim()}
            accessibilityRole="button"
          >
            <Feather
              name="send"
              size={20}
              color={messageText.trim() ? colors.onPrimary : colors.outline}
              style={{ marginLeft: -2, marginTop: 2 }}
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
    backgroundColor: colors.surface,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineHairline,
    ...shadows.card,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  headerCenter: {
    alignItems: 'center',
  },
  driverName: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  driverSubInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  driverSubText: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  dotSeparator: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.outline,
    marginHorizontal: 4,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryContainer,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  tripBannerText: {
    ...typography.labelSm,
    color: colors.onSecondaryContainer,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatCanvas: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.md,
    gap: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineHairline,
  },
  dateText: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  messageRowLeft: {
    alignItems: 'flex-start',
    marginBottom: spacing.md,
    maxWidth: '80%',
  },
  messageBubbleLeft: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: borderRadius.lg,
    borderTopLeftRadius: borderRadius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  messageTextLeft: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  messageRowRight: {
    alignItems: 'flex-end',
    marginBottom: spacing.md,
    alignSelf: 'flex-end',
    maxWidth: '80%',
  },
  messageBubbleRight: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.lg,
    borderTopRightRadius: borderRadius.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  messageBubbleError: {
    backgroundColor: colors.errorContainer,
    borderWidth: 1,
    borderColor: colors.error,
  },
  messageTextRight: {
    ...typography.bodyMd,
    color: colors.onPrimary,
  },
  messageMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  timeText: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  retryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  retryText: {
    ...typography.labelSm,
    color: colors.error,
  },
  inputArea: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    gap: spacing.xs,
  },
  attachButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  inputContainer: {
    flex: 1,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : 0,
    maxHeight: 100,
  },
  textInput: {
    ...typography.bodyMd,
    color: colors.onSurface,
    paddingVertical: 8,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceContainerHighest,
  },
});

export default ActiveTripChatScreen;
