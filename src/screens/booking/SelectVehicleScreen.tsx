import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockVehicleTypes, type VehicleType } from '../../data/mockData';
import { useBooking, toGeoPoint } from '../../state/BookingContext';
import { getCustomerProfile } from '../../state/session';
import { createFareQuote, isQuoteBookable } from '../../api/payments';
import type { FareQuote } from '../../api/types';
import { useNearbyDrivers } from '../../hooks/useNearbyDrivers';
import Feather from 'react-native-vector-icons/Feather';
import TopAppBar from '../../components/organisms/TopAppBar';
import VehicleOptionCard from '../../components/molecules/VehicleOptionCard';
import { VehicleSelectionSkeleton, useSkeletonVisibility } from '../../components/skeleton';

export interface SelectVehicleScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: (vehicleId: string) => void;
  readonly onHelp?: () => void;
  readonly isLoading?: boolean;
}

/**
 * Normalizes and matches a driver's vehicleType against a vehicle option.
 * Handles canonical backend categories ('TWO_WHEELER'), display labels ('2 Wheeler', 'Bike'),
 * and IDs ('bike', '3-wheeler', 'mini-truck', 'pickup').
 */
export const matchesVehicleCategory = (
  driverVehicleType: string | undefined,
  vehicle: VehicleType
): boolean => {
  if (!driverVehicleType) return false;
  const d = driverVehicleType.toLowerCase().replace(/[^a-z0-9]/g, '');
  const vId = vehicle.id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const vCat = (vehicle.category ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const vName = vehicle.name.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (d === vId || (vCat && d === vCat)) return true;
  if (vName.includes(d) || d.includes(vName)) return true;

  if (vCat === 'twowheeler' && (d === '2wheeler' || d === 'bike' || d === 'twowheeler')) return true;
  if (vCat === 'threewheeler' && (d === '3wheeler' || d === 'eloader' || d === 'threewheeler')) return true;
  if (vCat === 'minitruck' && (d === 'minitruck' || d === 'tataace')) return true;
  if (
    vCat === 'pickuptruck' &&
    (d === 'pickuptruck' || d === 'pickup' || d === 'bolero' || d === 'pickuptruck')
  ) {
    return true;
  }

  return false;
};

/**
 * Formats a paise amount into Indian Rupee currency display without any 'Est.' prefix.
 * e.g. 15000 paise -> '₹150'
 */
export const formatFare = (payablePaise: number): string => {
  const rupees = payablePaise / 100;
  if (payablePaise % 100 === 0) {
    return `₹${rupees.toLocaleString('en-IN')}`;
  }
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface VehicleQuoteState {
  readonly quote?: FareQuote;
  readonly isLoading: boolean;
  readonly error?: string;
}

const SelectVehicleScreen: React.FC<SelectVehicleScreenProps & { navigation?: any; route?: any }> = ({
  onBack,
  onContinue,
  onHelp,
  isLoading = false,
  navigation,
  route,
}) => {
  const effectiveLoading = isLoading || route?.params?.isLoading;
  const showSkeleton = useSkeletonVisibility({
    isLoading: Boolean(effectiveLoading),
    hasData: false,
  });
  const { draft, setVehicleType, setSender, setQuote } = useBooking();
  const [selectedId, setSelectedId] = useState<string>(() => {
    if (draft.vehicleType) {
      const match = mockVehicleTypes.find(
        (v) =>
          v.name === draft.vehicleType ||
          v.id === draft.vehicleType ||
          (v.category && v.category === draft.vehicleType)
      );
      if (match) return match.id;
    }
    return 'mini-truck';
  });

  // ─── 1. Authenticated Customer Phone Number ──────────────────────────────────
  const [authPhone, setAuthPhone] = useState<string | null>(() => {
    try {
      return getAuth().currentUser?.phoneNumber ?? null;
    } catch {
      return null;
    }
  });
  const [profilePhone, setProfilePhone] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadProfilePhone = async () => {
      try {
        const profile = await getCustomerProfile();
        if (isMounted && profile) {
          const ph = (profile as any)?.phoneNumber || (profile as any)?.phone;
          if (ph) setProfilePhone(ph);
        }
      } catch {
        // Non-fatal
      }
    };
    void loadProfilePhone();

    try {
      const auth = getAuth();
      if (auth?.currentUser?.phoneNumber) {
        setAuthPhone(auth.currentUser.phoneNumber);
      }
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (isMounted) {
          setAuthPhone(user?.phoneNumber ?? null);
        }
      });
      return () => {
        isMounted = false;
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    } catch {
      return () => {
        isMounted = false;
      };
    }
  }, []);

  const displaySenderPhone =
    (draft.senderPhone && draft.senderPhone !== 'No Number' ? draft.senderPhone : null) ||
    authPhone ||
    profilePhone ||
    'Phone number unavailable';

  // Synchronize authenticated phone to booking draft if not previously set
  useEffect(() => {
    const verifiedPhone = authPhone || profilePhone;
    if ((!draft.senderPhone || draft.senderPhone === 'No Number') && verifiedPhone) {
      setSender({
        name: draft.senderName || 'Sender',
        phone: verifiedPhone,
        instructions: draft.pickupInstructions,
      });
    }
  }, [authPhone, profilePhone, draft.senderPhone, draft.senderName, draft.pickupInstructions, setSender]);

  // ─── 2. Nearby Driver Discovery & ETA ───────────────────────────────────────
  const { drivers, error: driversError, isLoading: driversLoading } = useNearbyDrivers(draft.pickup, {
    radiusKm: 20,
  });

  const getVehicleEta = useCallback(
    (vehicle: VehicleType): string | undefined => {
      // If discovery errored, is loading without data, or no drivers online: hide ETA completely
      if (driversError || driversLoading || !drivers || drivers.length === 0) {
        return undefined;
      }
      const eligible = drivers.filter(
        (d) => d.isAvailable && matchesVehicleCategory(d.vehicleType, vehicle)
      );
      if (eligible.length === 0) {
        return undefined; // Hide ETA completely when no eligible driver is available!
      }
      const minEta = Math.min(
        ...eligible.map((d) => {
          if (typeof d.etaMinutes === 'number' && Number.isFinite(d.etaMinutes) && d.etaMinutes > 0) {
            return d.etaMinutes;
          }
          const dKm = typeof d.distanceKm === 'number' && Number.isFinite(d.distanceKm) ? d.distanceKm : 1;
          return Math.max(1, Math.ceil((dKm / 25) * 60));
        })
      );
      return `${minEta} min`;
    },
    [drivers, driversError, driversLoading]
  );

  // ─── 3. Dynamic Fare Quotes ────────────────────────────────────────────────
  const [quotes, setQuotes] = useState<Record<string, VehicleQuoteState>>({});
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [retryTrigger, setRetryTrigger] = useState(0);

  const pickupLat = draft.pickup?.latitude;
  const pickupLng = draft.pickup?.longitude;
  const dropsCount = draft.drops.length;
  const dropsKey = draft.drops.map((d) => `${d.latitude},${d.longitude}`).join(';');
  const weightKg = draft.weightKg ?? 10;

  useEffect(() => {
    let isCancelled = false;
    setPricingError(null);

    if (!draft.pickup || draft.drops.length === 0) {
      const unavailable: Record<string, VehicleQuoteState> = {};
      for (const v of mockVehicleTypes) {
        unavailable[v.id] = { isLoading: false, error: 'Pickup and drop required' };
      }
      setQuotes(unavailable);
      return;
    }

    // Set initial loading state for priced vehicles
    setQuotes((prev) => {
      const next: Record<string, VehicleQuoteState> = { ...prev };
      for (const v of mockVehicleTypes) {
        if (v.category) {
          next[v.id] = { isLoading: true, quote: undefined, error: undefined };
        } else {
          next[v.id] = { isLoading: false, quote: undefined, error: 'Quote on request' };
        }
      }
      return next;
    });

    const geoPickup = toGeoPoint(draft.pickup);
    const geoDrops = draft.drops.map(toGeoPoint);

    let errorCount = 0;
    const pricedVehicleCount = mockVehicleTypes.filter((v) => v.category).length;

    const promises = mockVehicleTypes.map(async (v) => {
      if (!v.category) {
        if (!isCancelled) {
          setQuotes((prev) => ({
            ...prev,
            [v.id]: { isLoading: false, quote: undefined, error: 'Quote on request' },
          }));
        }
        return;
      }

      try {
        const freshQuote = await createFareQuote({
          pickup: geoPickup,
          drops: geoDrops,
          vehicleCategory: v.category,
          weightKg,
        });
        if (!isCancelled) {
          setQuotes((prev) => ({
            ...prev,
            [v.id]: { quote: freshQuote, isLoading: false, error: undefined },
          }));
        }
      } catch {
        if (!isCancelled) {
          errorCount++;
          setQuotes((prev) => ({
            ...prev,
            [v.id]: {
              quote: undefined,
              isLoading: false,
              error: 'Pricing unavailable',
            },
          }));
        }
      }
    });

    (async () => {
      await Promise.allSettled(promises);
      if (!isCancelled && errorCount > 0) {
        setPricingError(
          errorCount === pricedVehicleCount
            ? 'Unable to load vehicle prices. Please try again.'
            : 'Some vehicle prices could not be loaded.'
        );
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [pickupLat, pickupLng, dropsCount, dropsKey, weightKg, draft.pickup, draft.drops, retryTrigger]);

  const retryQuotes = useCallback(() => {
    setRetryTrigger((prev) => prev + 1);
  }, []);

  // ─── 4. Selection & Proceed Validation ──────────────────────────────────────
  const selectedVehicle = mockVehicleTypes.find((v) => v.id === selectedId);
  const selectedQuoteState = quotes[selectedId];
  const selectedQuote = selectedQuoteState?.quote;
  const isSelectedQuoteValid =
    Boolean(selectedQuote) &&
    isQuoteBookable(selectedQuote!) &&
    !selectedQuoteState?.isLoading;
  const isSelectedQuoteOnRequest = Boolean(selectedVehicle && !selectedVehicle.category);
  const canProceed = isSelectedQuoteOnRequest
    ? !selectedQuoteState?.isLoading
    : isSelectedQuoteValid;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TopAppBar
        title={strings.booking.selectVehicle}
        leadingIcon={<Text style={styles.backIcon}>←</Text>}
        onLeadingPress={() => (onBack ? onBack() : navigation?.goBack())}
        trailingIcon={<Text style={styles.helpText}>Help</Text>}
        onTrailingPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
      />

      {showSkeleton ? (
        <VehicleSelectionSkeleton testID="select-vehicle-skeleton-loading" />
      ) : (
        <>
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
        {/* Route Summary Card */}
        <View style={styles.routeSummaryCard}>
          <View style={styles.routeRow}>
            <View style={styles.routeTimeline}>
              <View style={styles.dotGreen} />
              <View style={styles.timelineLine} />
            </View>
            <View style={styles.routeItem}>
              <Text style={styles.routeItemTitle}>
                {draft.senderName || 'Sender'} · {displaySenderPhone}
              </Text>
              <Text style={styles.routeItemAddress} numberOfLines={1}>
                {draft.pickup?.address || 'Pickup Location'}
              </Text>
            </View>
          </View>

          {draft.drops.map((drop, index) => {
            const isLast = index === draft.drops.length - 1;
            return (
              <View key={`drop-${index}`} style={styles.routeRow}>
                <View style={styles.routeTimeline}>
                  <View style={styles.dotRed} />
                  {!isLast && <View style={styles.timelineLine} />}
                </View>
                <View style={styles.routeItem}>
                  <Text style={styles.routeItemTitle}>
                    {drop.receiverName || 'Receiver'} · {drop.receiverPhone || 'No Number'}
                  </Text>
                  <Text style={styles.routeItemAddress} numberOfLines={1}>
                    {drop.address || 'Drop Location'}
                  </Text>
                </View>
              </View>
            );
          })}

          <View style={styles.routeActions}>
            <Pressable
              style={styles.routeActionBtn}
              onPress={() => navigation?.navigate('SelectDropLocationScreen', { mode: 'stop' })}
            >
              <Feather name="plus-circle" size={16} color={colors.primary} />
              <Text style={styles.routeActionText}>Add Stop</Text>
            </Pressable>
            <View style={styles.routeActionDivider} />
            <Pressable
              style={styles.routeActionBtn}
              onPress={() => navigation?.navigate('SelectLocationScreen', { mode: 'edit' })}
            >
              <Feather name="edit-2" size={16} color={colors.primary} />
              <Text style={styles.routeActionText}>Edit Locations</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.subtitleContainer}>
          <Text style={styles.subtitle}>Choose the right vehicle for your load.</Text>
        </View>

        {pricingError && (
          <View style={styles.pricingErrorBanner} testID="pricing-error-banner">
            <Feather name="alert-circle" size={18} color={colors.onErrorContainer} />
            <Text style={styles.pricingErrorText}>{pricingError}</Text>
            <Pressable
              style={styles.retryButton}
              onPress={retryQuotes}
              accessibilityRole="button"
              accessibilityLabel="Retry loading prices"
              testID="pricing-retry-button"
            >
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.vehicleList}>
          {mockVehicleTypes.map((vehicle) => {
            const quoteState = quotes[vehicle.id];
            const isLoading = quoteState?.isLoading ?? false;
            const hasQuote = Boolean(quoteState?.quote && isQuoteBookable(quoteState.quote));
            const isQuoteOnRequest = !vehicle.category;
            const isPricingError = Boolean(pricingError && quoteState?.error === 'Pricing unavailable');
            const isUnavailable = !isQuoteOnRequest && !isLoading && !hasQuote && !isPricingError;
            const displayPrice = hasQuote && quoteState?.quote
              ? formatFare(quoteState.quote.payablePaise)
              : isPricingError ? '\u2014' : '';
            const unavailableMessage = isQuoteOnRequest
              ? 'Quote on request'
              : quoteState?.error || 'Unavailable';
            const eta = getVehicleEta(vehicle);

            return (
              <VehicleOptionCard
                key={vehicle.id}
                testID={`vehicle-card-${vehicle.id}`}
                name={vehicle.name}
                description={vehicle.description}
                capacity={vehicle.capacity}
                price={displayPrice}
                isLoading={isLoading}
                isUnavailable={isUnavailable}
                isQuoteOnRequest={isQuoteOnRequest}
                unavailableMessage={unavailableMessage}
                eta={eta}
                image={vehicle.image}
                selected={selectedId === vehicle.id}
                onPress={() => setSelectedId(vehicle.id)}
              />
            );
          })}
        </View>
      </ScrollView>

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <Pressable
          style={[styles.footerContent, !canProceed && styles.footerDisabled]}
          disabled={!canProceed}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canProceed }}
          accessibilityLabel={`Proceed with ${selectedVehicle?.name?.split(' /')[0] ?? 'Vehicle'}`}
          onPress={() => {
            if (!canProceed) return;
            setVehicleType(selectedVehicle?.name ?? selectedId);
            setQuote(selectedQuote);
            onContinue?.(selectedId);
            navigation?.navigate('GoodsDetailsScreen');
          }}
        >
          <Text style={styles.ctaLabel}>
            {`Proceed With ${selectedVehicle?.name?.split(' /')[0] ?? 'Vehicle'}`}
          </Text>
        </Pressable>
      </View>
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  backIcon: {
    fontSize: 22,
    color: colors.onSurface,
  },
  helpText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxl,
  },
  routeSummaryCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    ...shadows.sm,
  },
  routeRow: {
    flexDirection: 'row',
  },
  routeTimeline: {
    width: 24,
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  dotGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusGreen,
    marginTop: 16,
  },
  dotRed: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusRed,
    marginTop: 16,
  },
  timelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
    borderStyle: 'dashed',
    minHeight: 24,
  },
  routeItem: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  routeItemTitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  routeItemAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    fontWeight: '500',
    marginTop: 2,
  },
  routeActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  routeActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  routeActionText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
    fontWeight: '600',
  },
  routeActionDivider: {
    width: 1,
    backgroundColor: colors.outlineHairline,
  },
  subtitleContainer: {
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  vehicleList: {
    gap: spacing.md,
  },
  pricingErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  pricingErrorText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onErrorContainer,
    fontFamily: typography.bodyMd.fontFamily,
  },
  retryButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  retryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
  footerContent: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
  },
  footerDisabled: {
    backgroundColor: colors.outlineVariant,
    opacity: 0.6,
  },
  ctaLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default SelectVehicleScreen;
