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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
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

  const mapImageStatus = (status: ChatMessage['status']): 'uploading' | 'sent' | 'failed' => {
    if (status === 'sending') return 'uploading';
    if (status === 'error') return 'failed';
    return 'sent';
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
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
        title={t('chat.title')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {isLoading && messages.length === 0 ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.centered}>
            <Text style={styles.emptyTitle}>{t('chat.emptyState')}</Text>
            <Text style={styles.emptySub}>{t('chat.emptyStateSub')}</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.messageList}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            placeholder={t('chat.placeholder')}
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
            <Text style={[styles.sendIcon, !inputText.trim() && styles.sendIconDisabled]}>
              send
            </Text>
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
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
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
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    ...typography.bodyMd,
    color: colors.onSurface,
    maxHeight: 100,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: colors.surfaceContainerHigh,
  },
  sendIcon: {
    fontSize: 20,
    color: colors.onPrimary,
  },
  sendIconDisabled: {
    color: colors.outline,
  },
});

export default ActiveTripChatScreen;