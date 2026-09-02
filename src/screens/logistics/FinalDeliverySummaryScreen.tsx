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

export interface FinalDeliverySummaryScreenProps {
  readonly onBack?: () => void;
  readonly onConfirmPayment?: () => void;
}

const FinalDeliverySummaryScreen: React.FC<FinalDeliverySummaryScreenProps & { navigation?: any }> = ({
  onBack,
  onConfirmPayment,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
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
        <Text style={styles.headerTitle}>Trip Summary</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Main Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Banner */}
        <View style={styles.successBanner}>
          <Feather name="check-circle" size={20} color="#2e7d32" />
          <Text style={styles.successBannerText}>ALL DELIVERIES COMPLETED</Text>
        </View>

        {/* Trip Overview Card */}
        <View style={styles.overviewCard}>
          <View style={styles.overviewHeader}>
            <View>
              <Text style={styles.overviewTitle}>Overall Status</Text>
              <Text style={styles.overviewSubtitle}>Total Duration: 1h 45m</Text>
            </View>
            <View style={styles.deliveredBadge}>
              <Feather name="check-square" size={14} color="#1b5e20" />
              <Text style={styles.deliveredBadgeText}>Delivered</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.timelineList}>
            {/* Vertical Line connecting dots */}
            <View style={styles.timelineLine} />

            {/* Pickup */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineDotContainer}>
                <View style={styles.timelineDot} />
              </View>
              <View style={styles.timelineItemContent}>
                <Text style={styles.timelineItemTitle}>Pickup: Sardarpura Warehouse</Text>
                <Text style={styles.timelineItemSubtitle}>Completed at 9:30 AM</Text>
              </View>
            </View>

            {/* Drop 1 */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineDotContainer}>
                <View style={styles.timelineDot} />
              </View>
              <View style={styles.timelineItemContent}>
                <Text style={styles.timelineItemTitle}>Drop 1: Ratanada Hub</Text>
                <Text style={styles.timelineItemSubtitle}>Completed at 10:15 AM</Text>
              </View>
            </View>

            {/* Drop 2 */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineDotContainer}>
                <View style={styles.timelineDot} />
              </View>
              <View style={styles.timelineItemContent}>
                <Text style={styles.timelineItemTitle}>Drop 2: Pal Road Business Center</Text>
                <Text style={styles.timelineItemSubtitle}>Completed at 10:45 AM</Text>
              </View>
            </View>

            {/* Drop 3 */}
            <View style={styles.timelineItem}>
              <View style={styles.timelineDotContainer}>
                <View style={styles.timelineDot} />
              </View>
              <View style={styles.timelineItemContent}>
                <Text style={styles.timelineItemTitle}>Drop 3: Basni Phase II</Text>
                <Text style={styles.timelineItemSubtitle}>Completed at 11:15 AM</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Proof Section */}
        <View style={styles.proofCard}>
          <View style={styles.proofContent}>
            <Feather name="shield" size={20} color={colors.primary} />
            <Text style={styles.proofText}>All Delivery Proofs Verified</Text>
          </View>
          <Feather name="check" size={16} color={colors.primary} />
        </View>
      </ScrollView>

      {/* Payment Confirmation Section */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.confirmButton}
          onPress={() => {
            onConfirmPayment?.();
            navigation?.navigate('PaymentSelectionScreen');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.confirmText}>CONFIRM PAYMENT & CLOSE TRIP</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
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
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.lg,
    paddingBottom: 100,
    gap: spacing.xl,
  },

  // Success Banner
  successBanner: {
    backgroundColor: '#e8f5e9',
    padding: spacing.md,
    borderRadius: borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  successBannerText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: '#1b5e20',
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },

  // Overview Card
  overviewCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.card,
  },
  overviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  overviewTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  overviewSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },
  deliveredBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deliveredBadgeText: {
    fontSize: typography.labelSm.fontSize,
    color: '#1b5e20',
    fontFamily: typography.labelSm.fontFamily,
  },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginBottom: spacing.lg,
  },

  // Timeline
  timelineList: {
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 11,
    top: 16,
    bottom: 16,
    width: 2,
    backgroundColor: colors.outlineVariant,
    opacity: 0.5,
    zIndex: 0,
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.xl,
    zIndex: 10,
  },
  timelineDotContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  timelineItemContent: {
    flex: 1,
  },
  timelineItemTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  timelineItemSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },

  // Proof Card
  proofCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  proofContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  proofText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
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
    paddingBottom: spacing.xxl, // safe area approx
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    ...shadows.elevated,
  },
  confirmButton: {
    backgroundColor: colors.primary, // using primary instead of primaryContainer for higher contrast
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
    textTransform: 'uppercase',
  },
});

export default FinalDeliverySummaryScreen;
