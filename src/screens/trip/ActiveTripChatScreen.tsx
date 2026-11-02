import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, Platform, ActivityIndicator, KeyboardAvoidingView, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { chatLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { ChatBubble } from '../../components/molecules/ChatBubble';
import type { ChatMessage } from '../../types/chat';
import type { ChatRouteParams } from '../../types/navigation';
import { useActiveTrip } from '../../hooks/useActiveTrip';
import { useChat } from '../../hooks/useChat';
import { chatUuid, type ChatConversation } from '../../services/chat/ChatService';

/**
 * ActiveTripChatScreen
 * Customer conversation for the authenticated driver's confirmed assignment.
 */
export interface ActiveTripChatScreenProps {
  readonly navigation: {goBack(): void};
  readonly route: {params: ChatRouteParams};
  readonly testID?: string;
}

export const ActiveTripChatScreen: React.FC<ActiveTripChatScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const trip = useActiveTrip(route.params.tripId);
  const paymentTripId = route.params.paymentTripId ?? (trip?.id === route.params.tripId ? trip?.paymentTripId : undefined);
  const conversation = useMemo<ChatConversation | undefined>(() => {
    if (route.params.bookingId && chatUuid.test(route.params.bookingId)) return {kind: 'BOOKING', id: route.params.bookingId};
    if (paymentTripId && chatUuid.test(paymentTripId)) return {kind: 'TRIP', id: paymentTripId};
    return undefined;
  }, [route.params.bookingId, paymentTripId]);
  const matchesTrip = trip && ((route.params.tripId && trip.id === route.params.tripId) || (paymentTripId && trip.paymentTripId === paymentTripId));
  const ended = !!matchesTrip && [trip?.status, trip?.engineStatus].some(value => ['COMPLETED','CANCELLED'].includes(String(value).toUpperCase()));
  const {messages, isLoading, error, closed, ready, sendMessage, retryMessage, fetchMessages} = useChat(conversation, ended);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  useEffect(() => { setInputText(''); }, [conversation?.kind, conversation?.id, closed]);

  const handleSend = useCallback(() => {
    if (!ready || !inputText.trim()) return;
    const text = inputText;
    setInputText('');
    sendMessage(text).catch(() => undefined);
  }, [inputText, ready, sendMessage]);

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    return (
      <View>
      <ChatBubble
        text={item.text ?? ''}
        timestamp={Number.isFinite(Date.parse(item.timestamp)) ? new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : ''}
        sender={item.sender === 'driver' ? 'driver' : 'other'}
        status={item.status === 'error' ? 'failed' : item.status}
      />
      {item.status === 'error' && <Pressable accessibilityRole="button" accessibilityLabel="Retry message" disabled={!ready} onPress={() => { retryMessage(item).catch(() => undefined); }}><Text style={styles.notice}>Send not confirmed — tap to retry</Text></Pressable>}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title="Customer chat"
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={90}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={styles.messageList}
          ListHeaderComponent={isLoading ? <ActivityIndicator accessibilityLabel="Loading chat" /> : undefined}
          ListEmptyComponent={<Text style={styles.notice}>{closed ? 'This trip has ended. Chat is closed.' : conversation ? 'No messages yet.' : 'Chat becomes available after assignment is confirmed.'}</Text>}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        />

        {error ? <View><Text accessibilityRole="alert" style={styles.notice}>{error}</Text>{!closed && <Pressable accessibilityRole="button" accessibilityLabel="Refresh chat" onPress={fetchMessages}><Text style={styles.notice}>Retry</Text></Pressable>}</View> : null}
        <Text style={styles.notice}>Chat is available only during this assigned trip.</Text>
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            placeholder={chatLabels.inputPlaceholder}
            placeholderTextColor={colors.outline}
            value={inputText}
            editable={ready}
            maxLength={2000}
            onChangeText={setInputText}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          <Pressable
            style={[styles.sendButton, (!ready || !inputText.trim()) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!ready || !inputText.trim()}
            accessibilityRole="button"
            accessibilityLabel={chatLabels.sendLabel}
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
  notice: { color: colors.onSurface, paddingHorizontal: spacing.containerPadding, paddingVertical: spacing.unit, ...typography.bodyMd },
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
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
