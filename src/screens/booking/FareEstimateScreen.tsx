import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings } from '../../data/mockData';
import { useBooking } from '../../state/BookingContext';
import { getFareEstimate } from '../../api/engine';
import { toApiError } from '../../api/http';
import { Feather } from '@expo/vector-icons';

export interface FareEstimateScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
  readonly onHelp?: () => void;
}

interface BreakdownItem {
  readonly label: string;
  readonly sublabel?: string;
  readonly amount: string;
  readonly icon?: string;
  readonly isWarning?: boolean;
}

const FareEstimateScreen: React.FC<FareEstimateScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  onHelp,
  navigation,
}) => {
  const { draft, primaryDrop, setFareEstimate } = useBooking();
  const estimate = draft.fareEstimate;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const pickup = draft.pickup;
  /** The engine defaults to 10kg when weight is omitted; mirror that here. */
  const weightKg = draft.weightKg ?? 10;

  const loadEstimate = useCallback(async () => {
    if (!pickup || !primaryDrop) {
      setError('Pickup and drop are required for a fare estimate.');
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      setFareEstimate(await getFareEstimate(pickup, primaryDrop, weightKg));
    } catch (caught) {
      setError(toApiError(caught).userMessage);
    } finally {
      setIsLoading(false);
    }
  }, [pickup, primaryDrop, weightKg, setFareEstimate]);

  // Quote on entry, and re-quote whenever route or weight invalidated it.
  useEffect(() => {
    if (!estimate) void loadEstimate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estimate, pickup?.latitude, primaryDrop?.latitude, weightKg]);

  const breakdownItems: readonly BreakdownItem[] = estimate
    ? [
        { label: 'Base Fare', amount: `₹ ${estimate.breakdown.base}` },
        {
          label: 'Distance',
          sublabel: `${estimate.distanceKm} km at ₹${estimate.perKmCharge}/km`,
          amount: `₹ ${estimate.breakdown.distance}`,
        },
        {
          label: 'Weight Surcharge',
          sublabel: `${weightKg} kg · ${estimate.weightMultiplier}× multiplier`,
          amount: `₹ ${estimate.breakdown.weightSurcharge}`,
          icon: 'package',
        },
      ]
    : [];
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable
          style={styles.helpButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
          accessibilityRole="button"
          accessibilityLabel="Help"
        >
          <Text style={styles.helpText}>Help</Text>
        </Pressable>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.pageTitle}>{strings.booking.fareEstimate}</Text>
          <Text style={styles.pageSubtitle}>Review the estimated cost for your delivery.</Text>
        </View>

        {/* Total Card */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>ESTIMATED TOTAL</Text>
          {isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
          ) : (
            <View style={styles.totalAmountRow}>
              <Text style={styles.currencySymbol}>₹</Text>
              <Text style={styles.totalAmount}>{estimate ? estimate.fare : '—'}</Text>
            </View>
          )}
          {estimate && (
            <Text style={styles.totalMeta}>
              {estimate.distanceKm} km · about {estimate.durationMin} min
            </Text>
          )}
        </View>

        {error && (
          <Pressable style={styles.errorCard} onPress={loadEstimate} accessibilityRole="button">
            <Feather name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorCardText}>{error} Tap to retry.</Text>
          </Pressable>
        )}

        {/* Breakdown Card */}
        <View style={styles.breakdownCard}>
          <Text style={styles.breakdownTitle}>Breakdown</Text>
          {breakdownItems.map((item, index) => (
            <View
              key={item.label}
              style={[
                styles.breakdownRow,
                index < breakdownItems.length - 1 && styles.breakdownRowBorder,
              ]}
            >
              <View style={styles.breakdownLeft}>
                <View style={styles.breakdownLabelRow}>
                  {item.icon && (
                    <Feather
                      name={item.icon as any}
                      size={14}
                      color={item.isWarning ? colors.error : colors.onSurfaceVariant}
                    />
                  )}
                  <Text
                    style={[
                      styles.breakdownLabel,
                      item.isWarning && styles.breakdownLabelWarning,
                    ]}
                  >
                    {item.label}
                  </Text>
                </View>
                {item.sublabel && (
                  <Text style={styles.breakdownSublabel}>{item.sublabel}</Text>
                )}
              </View>
              <Text style={styles.breakdownAmount}>{item.amount}</Text>
            </View>
          ))}
        </View>

        {/* Disclaimer */}
        <View style={styles.disclaimerRow}>
          <Feather name="info" size={16} color={colors.outline} />
          <Text style={styles.disclaimerText}>
            Final fare may vary based on actual distance, waiting time, and unforeseen route changes during transit.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.continueButton}
          onPress={() => {
            onContinue?.();
            navigation?.navigate('ReviewBookingScreen');
          }}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          <Text style={styles.continueText}>CONTINUE</Text>
          <Feather name="arrow-right" size={18} color={colors.onPrimary} />
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    position: 'absolute',
    left: '50%',
    // Note: transform translateX not available directly, using textAlign instead
  },
  helpButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  helpText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Content
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.gutterSm,
    paddingBottom: 140,
    gap: spacing.xl,
  },

  // Title
  titleSection: {
    gap: 4,
  },
  pageTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onBackground,
    fontFamily: typography.headlineMd.fontFamily,
  },
  pageSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Total Card
  totalCard: {
    backgroundColor: colors.primaryContainer,
    borderRadius: 24,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.ghostShadow,
  },
  totalLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onPrimaryContainer,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    opacity: 0.8,
  },
  totalAmountRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  currencySymbol: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onPrimaryFixed,
    marginTop: 10,
  },
  totalAmount: {
    fontSize: 48,
    fontWeight: '600',
    color: colors.onPrimaryFixed,
    lineHeight: 56,
    letterSpacing: -1,
  },
  totalMeta: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: spacing.xs,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  errorCardText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.error,
    fontFamily: typography.bodyMd.fontFamily,
  },
  totalDecimals: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onPrimaryFixed,
    marginTop: 10,
  },

  // Breakdown Card
  breakdownCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.xl,
    ...shadows.ghostShadow,
  },
  breakdownTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.md,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  breakdownRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant + '80', // 50%
  },
  breakdownLeft: {
    flex: 1,
  },
  breakdownLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  breakdownLabel: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  breakdownLabelWarning: {
    color: colors.error,
  },
  breakdownSublabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  breakdownAmount: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },

  // Disclaimer
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  disclaimerText: {
    flex: 1,
    fontSize: typography.labelSm.fontSize,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
    lineHeight: 18,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant + '33', // 20%
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.xxl,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    ...shadows.elevated,
  },
  continueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default FareEstimateScreen;
