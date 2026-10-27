import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { launchImageLibrary } from 'react-native-image-picker';
import { colors, typography, spacing, borderRadius } from '../../theme';
import Icon from '../../components/atoms/Icon';
import { AppHeader } from '../../components/molecules/AppHeader';
import { ChatBubble } from '../../components/molecules/ChatBubble';
import { ChatImageBubble } from '../../components/molecules/ChatImageBubble';
import { useI18n } from '../../i18n';
import { useChat } from '../../hooks/useChat';
import type { ChatMessage } from '../../types/chat';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * ActiveTripChatScreen
 * In-trip real-time chat between Driver and Customer / Dispatch.
 */
export interface ActiveTripChatScreenProps {
  readonly navigation: HomeScreenProps<'ActiveTripChat'>['navigation'];
  readonly route: HomeScreenProps<'ActiveTripChat'>['route'];
  readonly testID?: string;
}

export const ActiveTripChatScreen: React.FC<ActiveTripChatScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const tripId = route.params?.tripId || 'active-trip';
  const recipientName = (route.params as any)?.recipientName || (route.params as any)?.customerName || 'Customer';
  const vehicleInfo = (route.params as any)?.vehicleType || 'Mini Truck';
  const { messages, isLoading, error, sendMessage, retryMessage, markAsRead } = useChat(tripId);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    markAsRead();
  }, [markAsRead, messages.length]);

  const handleSend = useCallback(async () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    setInputText('');
    await sendMessage(trimmed);
  }, [inputText, sendMessage]);

  const handlePickAttachment = useCallback(async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1024,
        maxHeight: 1024,
      });

      if (result.didCancel || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (asset.uri) {
        await sendMessage(inputText.trim() || 'Photo Attachment', asset.uri);
        setInputText('');
      }
    } catch {
      Alert.alert('Attachment', 'Unable to pick image. Please check camera and storage permissions.');
    }
  }, [inputText, sendMessage]);

  const mapImageStatus = (status: ChatMessage['status']): 'uploading' | 'sent' | 'failed' => {
    if (status === 'sending') return 'uploading';
    if (status === 'error') return 'failed';
    return 'sent';
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    if (item.sender === 'system') {
      return (
        <View style={styles.systemMessageContainer}>
          <View style={styles.systemMessagePill}>
            <Icon name="navigation" size={13} color="#475569" />
            <Text style={styles.systemMessageText}>{item.text}</Text>
          </View>
        </View>
      );
    }

    const isDriver = item.sender === 'driver';
    const isError = item.status === 'error';

    const bubbleStatus: 'sending' | 'sent' | 'delivered' | 'read' | 'failed' =
      item.status === 'error' ? 'failed' : item.status;

    const content = item.imageUrl ? (
      <ChatImageBubble
        imageUrl={item.imageUrl}
        timestamp={item.timestamp}
        isDriver={isDriver}
        status={mapImageStatus(item.status)}
      />
    ) : (
      <ChatBubble
        text={item.text ?? ''}
        timestamp={item.timestamp}
        sender={isDriver ? 'driver' : 'other'}
        status={bubbleStatus}
      />
    );

    if (isError && isDriver) {
      return (
        <Pressable
          onPress={() => retryMessage(item)}
          accessibilityRole="button"
          accessibilityLabel={t('chat.tapToRetry')}
        >
          {content}
          <Text style={styles.retryHint}>{t('chat.tapToRetry')}</Text>
        </Pressable>
      );
    }

    return content;
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={`${recipientName} • ${vehicleInfo}`}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      {/* Trip context live banner */}
      <View style={styles.tripBanner}>
        <Icon name="local_shipping" size={16} color="#1E293B" />
        <Text style={styles.tripBannerText}>Live Trip in Progress</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {isLoading && messages.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            ListHeaderComponent={
              <View style={styles.dateDivider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dateText}>TODAY</Text>
                <View style={styles.dividerLine} />
              </View>
            }
            ListEmptyComponent={
              <View style={styles.centered}>
                <Text style={styles.emptyTitle}>{t('chat.emptyState')}</Text>
                <Text style={styles.emptySub}>{t('chat.emptyStateSub')}</Text>
              </View>
            }
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <Pressable
            style={styles.attachButton}
            onPress={handlePickAttachment}
            accessibilityRole="button"
            accessibilityLabel="Attach photo"
          >
            <Icon name="attach_file" size={22} color="#64748B" />
          </Pressable>
          <TextInput
            style={styles.textInput}
            placeholder={`Message ${recipientName}...`}
            placeholderTextColor={colors.outline}
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
            accessibilityLabel={t('chat.send')}
          >
            <Icon name="send" size={18} color={inputText.trim() ? colors.onPrimary : colors.outline} />
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
  tripBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 8,
  },
  tripBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  container: {
    flex: 1,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginVertical: 12,
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
  systemMessagePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
  },
  systemMessageText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#475569',
  },
  centered: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.containerPadding,
  },
  emptyTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  emptySub: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  retryHint: {
    ...typography.labelSm,
    color: colors.error,
    textAlign: 'right',
    paddingRight: spacing.containerPadding,
    marginTop: -spacing.unit,
    marginBottom: spacing.xs,
  },
  messageList: {
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    gap: spacing.xs,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    backgroundColor: colors.surfaceContainerLowest,
  },
  attachButton: {
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#F1F5F9',
    borderRadius: borderRadius.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    ...typography.bodyMd,
    color: colors.onSurface,
    maxHeight: 100,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#F1F5F9',
  },
});

export default ActiveTripChatScreen;