import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapCanvas from '../../components/map/MapCanvas';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface ActiveTripTrackingScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  readonly onCall?: () => void;
  readonly onChat?: () => void;
  readonly onShare?: () => void;
}

const ActiveTripTrackingScreen: React.FC<ActiveTripTrackingScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  onCall,
  onChat,
  onShare,
  navigation,
}) => {
  return (
    <View style={styles.container}>
      {/* Real map behind the sheet. Static — the moving driver is shown on
          CustomerLiveTrackingScreen. This screen focuses on the multi-drop
          timeline in the sheet, so no live driver polling here. */}
      <MapCanvas style={styles.mapCanvas as any} scrollEnabled={false}>
        {/* Empty children just so JSX shape stays consistent. */}
        <View />

        {/* Top App Bar */}
        <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Pressable
                style={styles.iconButton}
                onPress={() => (onBack ? onBack() : navigation?.goBack())}
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <Feather name="arrow-left" size={22} color={colors.onSurfaceVariant} />
              </Pressable>
              <Text style={styles.headerTitle}>Trip Tracking</Text>
            </View>
            <Pressable
              style={styles.iconButton}
              onPress={() => (onHelp ? onHelp() : navigation?.navigate('LiveTrackingExceptionsScreen'))}
              accessibilityRole="button"
              accessibilityLabel="Help"
            >
              <Feather name="help-circle" size={22} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>
        </SafeAreaView>

        {/* Bottom Panel (BottomSheet) */}
        <SafeAreaView edges={['bottom']} style={styles.bottomSheetWrapper}>
          <View style={styles.bottomSheet}>
            {/* Handle */}
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>

            {/* ETA & Status Header */}
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.etaTitle}>Arriving in 8 mins</Text>
                <Text style={styles.etaSubtitle}>Drop 2 • Pal Road</Text>
              </View>
              <View style={styles.statusBadgeContainer}>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusBadgeText}>On Time</Text>
                </View>
                <Text style={styles.lastUpdatedText}>UPDATED 30S AGO</Text>
              </View>
            </View>

            {/* Multi-drop Timeline */}
            <ScrollView
              style={styles.timelineScroll}
              contentContainerStyle={styles.timelineContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.timelineList}>
                {/* Vertical Line */}
                <View style={styles.timelineLine} />

                {/* Pickup (Completed) */}
                <View style={styles.timelineItem}>
                  <View style={styles.iconDoneContainer}>
                    <View style={styles.iconDoneInner}>
                      <Feather name="check" size={12} color={colors.onPrimary} />
                    </View>
                  </View>
                  <View style={styles.timelineTextContainer}>
                    <Text style={styles.timelineTextStrikethrough}>Pickup</Text>
                    <Text style={styles.timelineTextDone}>Sardarpura Warehouse</Text>
                  </View>
                </View>

                {/* Drop 1 (Completed) */}
                <View style={styles.timelineItem}>
                  <View style={styles.iconDoneContainer}>
                    <View style={styles.iconDoneInner}>
                      <Feather name="check" size={12} color={colors.onPrimary} />
                    </View>
                  </View>
                  <View style={styles.timelineTextContainer}>
                    <Text style={styles.timelineTextStrikethrough}>Drop 1</Text>
                    <Text style={styles.timelineTextDone}>Ratanada Hub</Text>
                  </View>
                </View>

                {/* Drop 2 (Current) */}
                <View style={styles.timelineItem}>
                  <View style={styles.iconCurrentContainer}>
                    <View style={styles.iconCurrentOuter}>
                      <View style={styles.iconCurrentInner} />
                    </View>
                  </View>
                  <View style={styles.timelineTextContainer}>
                    <Text style={styles.timelineCurrentLabel}>Drop 2 (Current)</Text>
                    <Text style={styles.timelineCurrentTitle}>Pal Road</Text>
                  </View>
                </View>

                {/* Drop 3 (Upcoming) */}
                <View style={styles.timelineItem}>
                  <View style={styles.iconUpcomingContainer}>
                    <View style={styles.iconUpcomingInner} />
                  </View>
                  <View style={styles.timelineTextContainer}>
                    <Text style={styles.timelineUpcomingLabel}>Drop 3</Text>
                    <Text style={styles.timelineUpcomingTitle}>Basni Phase II</Text>
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Action Bar */}
            <View style={styles.actionBar}>
              <Pressable
                style={styles.actionButton}
                onPress={() => (onCall ? onCall() : navigation?.navigate('CallDriverScreen'))}
                accessibilityRole="button"
              >
                <Feather name="phone" size={20} color={colors.onSecondaryContainer} />
                <Text style={styles.actionButtonText}>Call</Text>
              </Pressable>
              <Pressable
                style={styles.actionButton}
                onPress={() => (onChat ? onChat() : navigation?.navigate('ActiveTripChatScreen'))}
                accessibilityRole="button"
              >
                <Feather name="message-circle" size={20} color={colors.onSecondaryContainer} />
                <Text style={styles.actionButtonText}>Chat</Text>
              </Pressable>
              <Pressable
                style={styles.iconAction}
                onPress={() => (onShare ? onShare() : navigation?.navigate('ShareTrackingSheetScreen'))}
                accessibilityRole="button"
              >
                <Feather name="share-2" size={20} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </MapCanvas>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapCanvas: {
    flex: 1,
    width: '100%',
    height: '100%',
  },

  // Header
  headerSafeArea: {
    backgroundColor: colors.surface + 'CC', // translucent
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    letterSpacing: -0.5,
  },

  // Bottom Sheet
  bottomSheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.lg,
  },
  bottomSheet: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    maxHeight: 530,
    ...shadows.elevated,
    overflow: 'hidden',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingBottom: 4,
  },
  dragHandle: {
    width: 48,
    height: 6,
    borderRadius: borderRadius.full,
    backgroundColor: colors.outlineVariant,
  },

  // Sheet Header
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant,
  },
  etaTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    letterSpacing: -0.5,
  },
  etaSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  statusBadgeContainer: {
    alignItems: 'flex-end',
  },
  statusBadge: {
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  lastUpdatedText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    marginTop: 6,
    textTransform: 'uppercase',
  },

  // Timeline
  timelineScroll: {
    flex: 1,
  },
  timelineContent: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  timelineList: {
    position: 'relative',
    paddingLeft: spacing.xl, // Space for line
    gap: spacing.xl,
  },
  timelineLine: {
    position: 'absolute',
    left: 11,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: colors.outlineVariant,
    zIndex: 0,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    position: 'relative',
    zIndex: 10,
  },
  iconDoneContainer: {
    position: 'absolute',
    left: -24,
    top: 2,
    backgroundColor: colors.surface,
    padding: 2,
    borderRadius: borderRadius.full,
  },
  iconDoneInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCurrentContainer: {
    position: 'absolute',
    left: -24,
    top: 2,
    backgroundColor: colors.surface,
    padding: 2,
    borderRadius: borderRadius.full,
  },
  iconCurrentOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  iconCurrentInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surface,
  },
  iconUpcomingContainer: {
    position: 'absolute',
    left: -24,
    top: 2,
    backgroundColor: colors.surface,
    padding: 2,
    borderRadius: borderRadius.full,
  },
  iconUpcomingInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.outline,
  },
  timelineTextContainer: {
    marginLeft: 8,
  },
  timelineTextStrikethrough: {
    fontSize: typography.dataMono.fontSize,
    color: colors.outline,
    fontFamily: typography.dataMono.fontFamily,
    textDecorationLine: 'line-through',
  },
  timelineTextDone: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.outline,
    fontFamily: typography.bodyMd.fontFamily,
  },
  timelineCurrentLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  timelineCurrentTitle: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  timelineUpcomingLabel: {
    fontSize: typography.dataMono.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
  },
  timelineUpcomingTitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Action Bar
  actionBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surfaceContainerLow,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryContainer,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
  },
  actionButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
  iconAction: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ActiveTripTrackingScreen;
