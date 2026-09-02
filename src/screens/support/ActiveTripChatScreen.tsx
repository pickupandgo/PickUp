import React, { useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { mockActiveTrip } from '../../data/mockData';

export interface ActiveTripChatScreenProps {
  readonly onBack?: () => void;
  readonly onNotifications?: () => void;
  readonly onAttachFile?: () => void;
}

const ActiveTripChatScreen: React.FC<ActiveTripChatScreenProps & { navigation?: any }> = ({
  onBack,
  onNotifications,
  onAttachFile,
  navigation,
}) => {
  const [messageText, setMessageText] = useState('');

  const handleSend = () => {
    setMessageText('');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoid}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Pressable
              style={styles.iconButton}
              onPress={() => (onBack ? onBack() : navigation?.goBack())}
            >
              <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
            </Pressable>
            
            <View style={styles.headerCenter}>
              <Text style={styles.driverName}>{mockActiveTrip.driverName}</Text>
              <View style={styles.driverSubInfo}>
                <Text style={styles.driverSubText}>{mockActiveTrip.vehicleType}</Text>
                <View style={styles.dotSeparator} />
                <Feather name="star" size={12} color={colors.tertiary} />
                <Text style={styles.driverSubText}>{mockActiveTrip.driverRating}</Text>
              </View>
            </View>
            
            <Pressable
              style={styles.iconButton}
              onPress={() =>
                onNotifications
                  ? onNotifications()
                  : navigation?.navigate('NotificationCenterScreen')
              }
            >
              <Feather name="bell" size={24} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* Trip Context Banner */}
          <View style={styles.tripBanner}>
            <Feather name="truck" size={16} color={colors.secondary} />
            <Text style={styles.tripBannerText}>En route to Drop 1 of 3</Text>
          </View>
        </View>

        {/* Chat Canvas */}
        <ScrollView contentContainerStyle={styles.chatCanvas}>
          {/* Date Divider */}
          <View style={styles.dateDivider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dateText}>TODAY</Text>
            <View style={styles.dividerLine} />
          </View>

          {/* System Message */}
          <View style={styles.systemMessageContainer}>
            <View style={styles.systemMessage}>
              <Feather name="map-pin" size={14} color={colors.onSurfaceVariant} />
              <Text style={styles.systemMessageText}>Driver arrived at Pickup Location</Text>
            </View>
          </View>

          {/* Driver Message */}
          <View style={styles.messageRowLeft}>
            <View style={styles.messageBubbleLeft}>
              <Text style={styles.messageTextLeft}>
                I have reached the pickup point. Loading is in progress.
              </Text>
            </View>
            <Text style={styles.timeText}>10:15 AM</Text>
          </View>

          {/* Customer Message */}
          <View style={styles.messageRowRight}>
            <View style={styles.messageBubbleRight}>
              <Text style={styles.messageTextRight}>
                Great. Please ensure all 12 boxes are secured.
              </Text>
            </View>
            <View style={styles.messageMetaRight}>
              <Text style={styles.timeText}>10:18 AM</Text>
              <Feather name="check-circle" size={14} color={colors.primary} />
            </View>
          </View>

          {/* System Message */}
          <View style={styles.systemMessageContainer}>
            <View style={styles.systemMessage}>
              <Feather name="navigation" size={14} color={colors.onSurfaceVariant} />
              <Text style={styles.systemMessageText}>En route to Drop 1: Sardarada Warehouse</Text>
            </View>
          </View>

          {/* Driver Message */}
          <View style={styles.messageRowLeft}>
            <View style={styles.messageBubbleLeft}>
              <Text style={styles.messageTextLeft}>
                Arriving at Sardarada Warehouse in 5 mins. Traffic is light.
              </Text>
            </View>
            <Text style={styles.timeText}>11:45 AM</Text>
          </View>

          {/* Media Attachment (Uploading State) */}
          <View style={styles.messageRowRight}>
            <View style={styles.mediaBubbleRight}>
              <View style={styles.mediaContainer}>
                <Image
                  source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCAgsW0QCCUjG3BZXWJpElmFSQG5GXK1CiJvqKlv7wdIU9r-RTet_5Dc5Mu9L91SO2tV3DchNxg1cn2lWeLZ6hPMMjaFoy1f2UFDOb7LpOP9A7rVBGTBsrZ1cC--Yjo-RvqHxVyB5DrxTQCmyJxt7yQknfEko04rIZay7lsew0SJIaRinmb-qcYQpfXLo_m6CJ_6dEXW1s1nOXKRwHBoN_0eMDE-VFx7TsE6730wbPS9gRsSYdRUaP5' }}
                  style={styles.mediaImageUploading}
                />
                <View style={styles.uploadOverlay}>
                  <Feather name="loader" size={24} color={colors.onSurface} style={styles.spinIcon} />
                  <View style={styles.uploadBadge}>
                    <Text style={styles.uploadBadgeText}>Uploading...</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* Pending Text Message */}
          <View style={styles.messageRowRight}>
            <View style={[styles.messageBubbleRight, styles.messageBubblePending]}>
              <Text style={styles.messageTextRight}>
                Wait near Gate B, someone will assist you.
              </Text>
            </View>
            <View style={styles.messageMetaRight}>
              <Text style={styles.timeText}>Sending...</Text>
              <Feather name="clock" size={14} color={colors.outline} />
            </View>
          </View>
        </ScrollView>

        {/* Message Input Area */}
        <View style={styles.inputArea}>
          {onAttachFile ? (
            <Pressable style={styles.attachButton} onPress={() => onAttachFile()}>
              <Feather name="paperclip" size={24} color={colors.onSurfaceVariant} />
            </Pressable>
          ) : (
            <View style={styles.attachButton}>
              <Feather name="paperclip" size={24} color={colors.onSurfaceVariant} />
            </View>
          )}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              placeholder={`Message ${mockActiveTrip.driverName?.split(' ')[0]}...`}
              placeholderTextColor={colors.onSurfaceVariant + 'B3'} // 70%
              value={messageText}
              onChangeText={setMessageText}
              multiline
            />
          </View>
          <Pressable style={styles.sendButton} onPress={handleSend}>
            <Feather name="send" size={20} color={colors.onPrimary} style={{ marginLeft: -2, marginTop: 2 }} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    backgroundColor: colors.surface,
    ...shadows.sm,
    zIndex: 10,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    alignItems: 'center',
  },
  driverName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  driverSubInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  driverSubText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  dotSeparator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },
  tripBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerLow,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant + '4D',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  tripBannerText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Chat Canvas
  chatCanvas: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },
  dateDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginVertical: spacing.sm,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.outlineVariant,
    opacity: 0.3,
  },
  dateText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },

  systemMessageContainer: {
    alignItems: 'center',
  },
  systemMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  systemMessageText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  messageRowLeft: {
    alignItems: 'flex-start',
    width: '100%',
    gap: 4,
  },
  messageBubbleLeft: {
    backgroundColor: colors.surfaceContainerHigh,
    padding: spacing.md,
    borderRadius: 16,
    borderTopLeftRadius: 4,
    maxWidth: '80%',
    ...shadows.sm,
  },
  messageTextLeft: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  
  messageRowRight: {
    alignItems: 'flex-end',
    width: '100%',
    gap: 4,
  },
  messageBubbleRight: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 16,
    borderTopRightRadius: 4,
    maxWidth: '80%',
    ...shadows.sm,
  },
  messageTextRight: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onPrimary,
    fontFamily: typography.bodyMd.fontFamily,
  },
  messageMetaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  timeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
    paddingHorizontal: 4,
  },

  mediaBubbleRight: {
    backgroundColor: colors.primary,
    padding: 4,
    borderRadius: 16,
    borderTopRightRadius: 4,
    maxWidth: '80%',
    ...shadows.sm,
  },
  mediaContainer: {
    width: 192,
    height: 128,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.surfaceVariant,
    position: 'relative',
  },
  mediaImageUploading: {
    width: '100%',
    height: '100%',
    opacity: 0.5,
    // grayscale is not supported natively via simple style without tintColor tricks, 
    // we'll rely on opacity for the mock effect
  },
  uploadOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface + '66', // 40% opacity
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  spinIcon: {
    // Note: React Native doesn't have a simple built-in spin animation class,
    // in a real app we'd use Animated or an ActivityIndicator.
    // For mock, it's just an icon.
  },
  uploadBadge: {
    backgroundColor: colors.surface + 'CC',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  uploadBadgeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
  messageBubblePending: {
    opacity: 0.8,
  },

  // Input Area
  inputArea: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.outlineVariant + '4D',
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  attachButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  inputContainer: {
    flex: 1,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 24,
    minHeight: 48,
    maxHeight: 120,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  textInput: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    maxHeight: 100,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
});

export default ActiveTripChatScreen;
