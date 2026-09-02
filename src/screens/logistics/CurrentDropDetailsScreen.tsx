import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface CurrentDropDetailsScreenProps {
  readonly onBack?: () => void;
  readonly onMore?: () => void;
  readonly onCallDriver?: () => void;
  readonly onChat?: () => void;
  readonly onTrackMap?: () => void;
}

const CurrentDropDetailsScreen: React.FC<CurrentDropDetailsScreenProps & { navigation?: any }> = ({
  onBack,
  onMore,
  onCallDriver,
  onChat,
  onTrackMap,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip Details</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onMore ? onMore() : navigation?.navigate('ShareTrackingSheetScreen'))}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <Feather name="more-vertical" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Main Canvas */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Active Stop Highlight Card */}
        <View style={styles.highlightCard}>
          <View style={styles.highlightCardTop}>
            <View style={styles.highlightCardInfo}>
              <View style={styles.dropBadge}>
                <Text style={styles.dropBadgeText}>DROP 2 OF 3</Text>
              </View>
              <Text style={styles.dropTitle}>Pal Road Business Center</Text>
              <View style={styles.dropLocationRow}>
                <Feather name="map-pin" size={14} color={colors.onSurfaceVariant} />
                <Text style={styles.dropLocationText}>Near Jodhpur Arpt</Text>
              </View>
            </View>
            
            <View style={styles.etaContainer}>
              <Text style={styles.etaTime}>8</Text>
              <Text style={styles.etaLabel}>MINS</Text>
            </View>
          </View>

          <View style={styles.highlightCardBottom}>
            <View style={styles.pulseIndicator} />
            <Text style={styles.statusText}>In Transit</Text>
            <Text style={styles.distanceText}>2.4 km</Text>
          </View>
        </View>

        {/* Receiver & Instructions Bento */}
        <View style={styles.bentoContainer}>
          <View style={styles.receiverCard}>
            <View style={styles.receiverIconBox}>
              <Feather name="user" size={20} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.receiverInfo}>
              <Text style={styles.receiverLabel}>Receiver</Text>
              <Text style={styles.receiverName}>Aravind Sharma</Text>
            </View>
          </View>

          <View style={styles.instructionsCard}>
            <View style={styles.instructionsHeader}>
              <Feather name="file-text" size={18} color={colors.primary} />
              <Text style={styles.instructionsTitle}>INSTRUCTIONS</Text>
            </View>
            <Text style={styles.instructionsText}>
              Leave at security gate and call upon arrival.
            </Text>
          </View>
        </View>

        {/* Vertical Timeline */}
        <View style={styles.timelineCard}>
          <Text style={styles.timelineTitle}>Trip Route</Text>
          
          <View style={styles.timelineList}>
            {/* Connecting line */}
            <View style={styles.timelineLine} />

            {/* Stop 1 (Done) */}
            <View style={styles.timelineItem}>
              <View style={styles.dotDoneContainer}>
                <View style={styles.dotDoneInner} />
              </View>
              <View style={styles.timelineItemContent}>
                <Text style={styles.timelineLabel}>Pickup</Text>
                <Text style={styles.timelineTextDone}>Sardarpura Warehouse</Text>
              </View>
            </View>

            {/* Stop 2 (Done) */}
            <View style={styles.timelineItem}>
              <View style={styles.dotDoneContainer}>
                <View style={styles.dotDoneInner} />
              </View>
              <View style={styles.timelineItemContent}>
                <Text style={styles.timelineLabel}>Drop 1</Text>
                <Text style={styles.timelineTextDone}>Ratanada Hub</Text>
              </View>
            </View>

            {/* Stop 3 (Current) */}
            <View style={styles.timelineItem}>
              <View style={styles.dotCurrentContainer}>
                <View style={styles.dotCurrentInner} />
              </View>
              <View style={styles.timelineCurrentCard}>
                <Text style={styles.timelineCurrentLabel}>Drop 2 of 3</Text>
                <Text style={styles.timelineCurrentText}>Pal Road</Text>
              </View>
            </View>

            {/* Stop 4 (Upcoming) */}
            <View style={styles.timelineItem}>
              <View style={styles.dotUpcoming} />
              <View style={styles.timelineItemContent}>
                <Text style={styles.timelineLabel}>Drop 3</Text>
                <Text style={styles.timelineTextUpcoming}>Basni Phase II</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Primary Actions */}
        <View style={styles.actionsGrid}>
          <Pressable
            style={styles.actionSecondary}
            onPress={() => (onCallDriver ? onCallDriver() : navigation?.navigate('CallDriverScreen'))}
            accessibilityRole="button"
          >
            <Feather name="phone" size={20} color={colors.primary} />
            <Text style={styles.actionSecondaryText}>Call Driver</Text>
          </Pressable>
          <Pressable
            style={styles.actionSecondary}
            onPress={() => (onChat ? onChat() : navigation?.navigate('ActiveTripChatScreen'))}
            accessibilityRole="button"
          >
            <Feather name="message-circle" size={20} color={colors.primary} />
            <Text style={styles.actionSecondaryText}>Chat</Text>
          </Pressable>
          <Pressable
            style={styles.actionPrimary}
            onPress={() => (onTrackMap ? onTrackMap() : navigation?.navigate('LiveTrackingScreen'))}
            accessibilityRole="button"
          >
            <Feather name="map" size={20} color={colors.onPrimary} />
            <Text style={styles.actionPrimaryText}>Track Map</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.verifyOtpButton}
          onPress={() => navigation?.navigate('DropOtpVerificationScreen')}
          accessibilityRole="button"
        >
          <Text style={styles.verifyOtpText}>VERIFY DROP OTP</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.lg,
    paddingBottom: 140, // clears the fixed bottom action bar
    gap: spacing.xl,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    ...shadows.elevated,
  },
  verifyOtpButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  verifyOtpText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
    textTransform: 'uppercase',
  },

  // Highlight Card
  highlightCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    ...shadows.card,
  },
  highlightCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  highlightCardInfo: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  dropBadge: {
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
  },
  dropBadgeText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  dropTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  dropLocationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dropLocationText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  etaContainer: {
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
    ...shadows.card,
  },
  etaTime: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onPrimaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
  etaLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onPrimaryContainer,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
  },
  highlightCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainer,
  },
  pulseIndicator: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  statusText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.bodyMd.fontFamily,
  },
  distanceText: {
    fontSize: typography.dataMono.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
  },

  // Bento
  bentoContainer: {
    gap: spacing.md,
  },
  receiverCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  receiverIconBox: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  receiverInfo: {
    flex: 1,
  },
  receiverLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 2,
  },
  receiverName: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.bodyLg.fontFamily,
  },
  instructionsCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  },
  instructionsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  instructionsTitle: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  instructionsText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Timeline
  timelineCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
  },
  timelineTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.xl,
  },
  timelineList: {
    position: 'relative',
    marginLeft: 12,
    gap: spacing.xl,
  },
  timelineLine: {
    position: 'absolute',
    left: 6,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: colors.surfaceContainerHighest,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    position: 'relative',
  },
  dotDoneContainer: {
    position: 'absolute',
    left: -6,
    top: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 2,
    borderColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  dotDoneInner: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.outlineVariant,
  },
  dotCurrentContainer: {
    position: 'absolute',
    left: -9,
    top: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primaryContainer,
    borderWidth: 4,
    borderColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...shadows.card,
  },
  dotCurrentInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  dotUpcoming: {
    position: 'absolute',
    left: -6,
    top: 6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    zIndex: 10,
  },
  timelineItemContent: {
    flex: 1,
    marginLeft: 16,
  },
  timelineLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  timelineTextDone: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.outlineVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textDecorationLine: 'line-through',
  },
  timelineTextUpcoming: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  timelineCurrentCard: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    marginTop: -4,
    marginLeft: 16,
  },
  timelineCurrentLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  timelineCurrentText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Actions
  actionsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  actionSecondary: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionSecondaryText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  actionPrimary: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  actionPrimaryText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default CurrentDropDetailsScreen;
