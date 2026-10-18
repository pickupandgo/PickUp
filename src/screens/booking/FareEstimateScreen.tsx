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
import { strings, vehicleCategoryFor } from '../../data/mockData';
import { useBooking, toGeoPoint } from '../../state/BookingContext';
import { createFareQuote } from '../../api/payments';
import { toApiError } from '../../api/http';
import Feather from 'react-native-vector-icons/Feather';

export interface FareEstimateScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
  readonly onHelp?: () => void;
}

const rupees = (paise: number): string => `₹ ${(paise / 100).toFixed(2)}`;

const FareEstimateScreen: React.FC<FareEstimateScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  onHelp,
  navigation,
}) => {
  const { draft, setQuote } = useBooking();
  const quote = draft.quote;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>();

  const pickup = draft.pickup;
  /** The pricing defaults to 10kg when weight is omitted; mirror that here. */
  const weightKg = draft.weightKg ?? 10;
  const vehicleCategory = vehicleCategoryFor(draft.vehicleType);

  const loadQuote = useCallback(async () => {
    if (!pickup || draft.drops.length === 0) {
      setError('Pickup and at least one drop are required for a fare.');
      return;
    }
    if (!vehicleCategory) {
      setError('This vehicle is available on request only. Pick another vehicle for an instant fare.');
      return;
    }
    setIsLoading(true);
    setError(undefined);
    try {
      // The server prices the route. The app never calculates an authoritative fare.
      const fresh = await createFareQuote({
        pickup: toGeoPoint(pickup),
        drops: draft.drops.map(toGeoPoint),
        vehicleCategory,
        weightKg,
      });
      setQuote(fresh);
    } catch (caught) {
      setError(toApiError(caught).userMessage);
    } finally {
      setIsLoading(false);
    }
  }, [pickup, draft.drops, vehicleCategory, weightKg, setQuote]);

  // Quote on entry, and re-quote whenever the route, vehicle or weight invalidated it.
  useEffect(() => {
    if (!quote) void loadQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote, pickup?.latitude, draft.drops.length, vehicleCategory, weightKg]);

  const expired = quote ? Date.parse(quote.expiresAt) <= Date.now() : false;
  const canContinue = !!quote && !expired && !isLoading;

  const expiresLabel = quote
    ? new Date(quote.expiresAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
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

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.titleSection}>
          <Text style={styles.pageTitle}>{strings.booking.fareEstimate}</Text>
          <Text style={styles.pageSubtitle}>This is the fare set by the server for your route.</Text>
        </View>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>TOTAL FARE</Text>
          {isLoading ? (
            <ActivityIndicator color={colors.onPrimary} style={{ marginTop: spacing.sm }} />
          ) : (
            <View style={styles.totalAmountRow}>
              <Text style={styles.currencySymbol}>₹</Text>
              <Text style={styles.totalAmount}>{quote ? (quote.payablePaise / 100).toFixed(2) : '—'}</Text>
            </View>
          )}
          {quote && !isLoading && (
            <Text style={styles.totalMeta}>
              {(quote.distanceMeters / 1000).toFixed(1)} km
              {expired ? ' · quote expired' : ` · valid until ${expiresLabel}`}
            </Text>
          )}
        </View>

        {error && (
          <Pressable style={styles.errorCard} onPress={loadQuote} accessibilityRole="button">
            <Feather name="alert-circle" size={16} color={colors.error} />
            <Text style={styles.errorCardText}>{error} Tap to retry.</Text>
          </Pressable>
        )}

        {expired && !error && (
          <Pressable style={styles.errorCard} onPress={loadQuote} accessibilityRole="button">
            <Feather name="refresh-cw" size={16} color={colors.error} />
            <Text style={styles.errorCardText}>This fare has expired. Tap to get a new one.</Text>
          </Pressable>
        )}

        {quote && (
          <View style={styles.breakdownCard}>
            <Text style={styles.breakdownTitle}>Breakdown</Text>
            <View style={[styles.breakdownRow, styles.breakdownRowBorder]}>
              <Text style={styles.breakdownLabel}>Fare</Text>
              <Text style={styles.breakdownAmount}>{rupees(quote.farePaise)}</Text>
            </View>
            {quote.taxPaise > 0 && (
              <View style={[styles.breakdownRow, styles.breakdownRowBorder]}>
                <Text style={styles.breakdownLabel}>Tax</Text>
                <Text style={styles.breakdownAmount}>{rupees(quote.taxPaise)}</Text>
              </View>
            )}
            {quote.drops.length > 1 &&
              quote.drops.map((drop) => (
                <View key={drop.sequence} style={[styles.breakdownRow, styles.breakdownRowBorder]}>
                  <View style={styles.breakdownLeft}>
                    <Text style={styles.breakdownLabel}>Drop {drop.sequence}</Text>
                    <Text style={styles.breakdownSublabel}>{(drop.distanceMeters / 1000).toFixed(1)} km</Text>
                  </View>
                  <Text style={styles.breakdownAmount}>{rupees(drop.payablePaise)}</Text>
                </View>
              ))}
            <View style={styles.breakdownRow}>
              <Text style={[styles.breakdownLabel, styles.totalRowLabel]}>Total</Text>
              <Text style={[styles.breakdownAmount, styles.totalRowAmount]}>{rupees(quote.payablePaise)}</Text>
            </View>
          </View>
        )}

        <View style={styles.disclaimerRow}>
          <Feather name="info" size={16} color={colors.outline} />
          <Text style={styles.disclaimerText}>
            The receiver (pay at delivery) or sender (pay at pickup) pays this amount to the driver. You never pay in the app.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable
          style={[styles.continueButton, !canContinue && styles.continueButtonDisabled]}
          disabled={!canContinue}
          onPress={() => {
            onContinue?.();
            navigation?.navigate('ReviewBookingScreen');
          }}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canContinue }}
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
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  backButton: { width: 40, height: 40, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  helpButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: borderRadius.full },
  helpText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.marginMobile, paddingTop: spacing.gutterSm, paddingBottom: 140, gap: spacing.xl },
  titleSection: { gap: 4 },
  pageTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onBackground,
    fontFamily: typography.headlineMd.fontFamily,
  },
  pageSubtitle: { fontSize: typography.bodyMd.fontSize, color: colors.onSurfaceVariant, fontFamily: typography.bodyMd.fontFamily },
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
  totalAmountRow: { flexDirection: 'row', alignItems: 'flex-start' },
  currencySymbol: { fontSize: typography.headlineMd.fontSize, fontWeight: typography.headlineMd.fontWeight, color: colors.onPrimary, marginTop: 10 },
  totalAmount: { fontSize: 48, fontWeight: '600', color: colors.onPrimary, lineHeight: 56, letterSpacing: -1 },
  totalMeta: { fontSize: typography.bodyMd.fontSize, color: colors.primaryFixedDim, fontFamily: typography.bodyMd.fontFamily, marginTop: spacing.xs },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  errorCardText: { flex: 1, fontSize: typography.bodyMd.fontSize, color: colors.error, fontFamily: typography.bodyMd.fontFamily },
  breakdownCard: { backgroundColor: colors.surfaceContainerLow, borderRadius: 24, padding: spacing.xl, ...shadows.ghostShadow },
  breakdownTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.md,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm },
  breakdownRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.surfaceVariant + '80' },
  breakdownLeft: { flex: 1 },
  breakdownLabel: { fontSize: typography.bodyMd.fontSize, color: colors.onSurfaceVariant, fontFamily: typography.bodyMd.fontFamily },
  totalRowLabel: { color: colors.onSurface, fontWeight: '700' },
  totalRowAmount: { color: colors.onSurface, fontWeight: '700' },
  breakdownSublabel: { fontSize: typography.labelSm.fontSize, color: colors.outline, fontFamily: typography.labelSm.fontFamily, marginTop: 2 },
  breakdownAmount: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  disclaimerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingHorizontal: spacing.sm },
  disclaimerText: { flex: 1, fontSize: typography.labelSm.fontSize, color: colors.outline, fontFamily: typography.labelSm.fontFamily, lineHeight: 18 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant + '33',
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
  continueButtonDisabled: { backgroundColor: colors.outlineVariant },
  continueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default FareEstimateScreen;
