import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockVehicleTypes, type VehicleType } from '../../data/mockData';
import { useBooking, toGeoPoint } from '../../state/BookingContext';
import { getCustomerProfile } from '../../state/session';
import { createFareQuote, isQuoteBookable } from '../../api/payments';
import type { FareQuote } from '../../api/types';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoadRoute } from '../../hooks/useRoute';
import { useNearbyDrivers } from '../../hooks/useNearbyDrivers';
import Feather from 'react-native-vector-icons/Feather';
import { useVehiclePreview } from '../../hooks/useVehiclePreview';
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
  const [fullRouteOpen, setFullRouteOpen] = useState(false);
  const safeInsets = useSafeAreaInsets();
  const { height: windowHeight, fontScale } = useWindowDimensions();
  const addressRowHeight = Math.max(spacing.rowHeightSm + spacing.sm, Math.ceil((spacing.rowHeightSm + spacing.sm) * fontScale));
  const addressScroll = useRef<ScrollView>(null);
  const road = useRoadRoute(draft.pickup, draft.drops[draft.drops.length - 1], draft.drops.slice(0, -1));
  const routeMarkers = useMemo<readonly MapMarker[]>(() => [
    ...(draft.pickup ? [{ id: 'pickup', kind: 'pickup' as const, coordinate: draft.pickup, title: 'Pickup' }] : []),
    ...draft.drops.map((drop, index) => ({ id: `drop-${index}`, kind: 'drop' as const, coordinate: drop, stopNumber: index + 1, title: `Drop ${index + 1}`, description: drop.address })),
  ], [draft.pickup, draft.drops]);
  useEffect(() => { addressScroll.current?.scrollTo({ y: 0, animated: false }); }, [draft.drops.length]);
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
  const preview = useVehiclePreview(draft.pickup, selectedVehicle?.category);
  const previewMarkers = useMemo<readonly MapMarker[]>(() => preview.vehicles.map(vehicle => ({ id: `preview-${selectedId}-${vehicle.key}`, kind: 'nearby', coordinate: vehicle, vehicleType: vehicle.vehicleCategory, title: selectedVehicle?.name.split(' /')[0], preview: true })), [preview.vehicles, selectedId, selectedVehicle?.name]);
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

      {showSkeleton ? (
        <VehicleSelectionSkeleton testID="select-vehicle-skeleton-loading" />
      ) : (
        <>
          <MapCanvas style={{ height: Math.max(spacing.rowHeightStandard * 3, Math.min(300, windowHeight * (windowHeight < 720 ? 0.28 : 0.34))) }} appearance="home"
            markers={[...routeMarkers, ...previewMarkers]} fitToMarkers={routeMarkers.length > 0} fitRouteOnly
            showsUserLocation
            contentInsets={{ top: spacing.rowHeightStandard + spacing.sm, bottom: spacing.xxl }}
            polyline={road.polyline} routeStatus={road.status} onRetryRoute={road.retry}>
            {preview.status === 'error' && <Pressable style={styles.previewNotice} accessibilityRole="button" accessibilityLabel="Retry nearby vehicle preview" onPress={preview.refresh}><Text style={styles.previewNoticeText}>Nearby vehicles unavailable. Retry</Text></Pressable>}
          </MapCanvas>
          <View style={styles.selectionSheet}>
          <View style={styles.sheetHandle} />
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
        <View style={styles.routeCardHeader}>
          <Pressable style={styles.fullRouteAction} accessibilityRole="button" accessibilityLabel="View All" onPress={() => setFullRouteOpen(true)}>
            <Text style={styles.fullRouteActionText}>View All</Text><Feather name="chevron-right" size={spacing.lg} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.routeSummaryCard} testID="vehicle-route-summary">
          <ScrollView ref={addressScroll} testID="vehicle-locations-scroll"
            style={{ height: addressRowHeight * Math.min(2, draft.drops.length + 1) }}
            contentContainerStyle={styles.addressScrollContent} nestedScrollEnabled
            scrollEnabled={draft.drops.length > 0} showsVerticalScrollIndicator persistentScrollbar>
            <View style={[styles.routeRow, { minHeight: addressRowHeight }]}>
              <View style={styles.routeTimeline}><View style={styles.dotGreen} /><View style={styles.timelineLine} /></View>
              <View style={styles.routeItem}>
                <Text style={[styles.routeItemTitle, styles.pickupLabel]}>PICKUP</Text>
                <Text style={styles.routeItemAddress} numberOfLines={1} ellipsizeMode="tail" accessibilityLabel={draft.pickup?.address}>{draft.pickup?.address || 'Pickup location'}</Text>
              </View>
            </View>
            {draft.drops.map((drop, index) => <View key={`drop-${index}`} style={[styles.routeRow, { minHeight: addressRowHeight }]}>
              <View style={styles.routeTimeline}><View style={styles.dropNumber}><Text style={styles.dropNumberText}>{index + 1}</Text></View>{index < draft.drops.length - 1 && <View style={styles.timelineLine} />}</View>
              <View style={styles.routeItem}>
                <Text style={styles.routeItemTitle}>DROP {index + 1} OF {draft.drops.length}</Text>
                <Text style={styles.routeItemAddress} numberOfLines={1} ellipsizeMode="tail" accessibilityLabel={drop.address}>{drop.address || 'Drop location'}</Text>
              </View>
            </View>)}
          </ScrollView>
          <View style={styles.routeActions}>
            <Pressable style={styles.routeActionBtn} accessibilityRole="button" accessibilityLabel="Add stop" disabled={draft.drops.length >= 5} onPress={() => navigation?.navigate('SelectDropLocationScreen', { mode: 'stop' })}>
              <Feather name="plus-circle" size={spacing.lg} color={colors.primary} /><Text style={styles.routeActionText}>Add stop</Text>
            </Pressable>
            <View style={styles.routeActionDivider} />
            <Pressable style={styles.routeActionBtn} accessibilityRole="button" accessibilityLabel="Edit route" onPress={() => navigation?.navigate('MultiDropOverviewScreen')}>
              <Feather name="edit-2" size={spacing.lg} color={colors.primary} /><Text style={styles.routeActionText}>Edit route</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.subtitleContainer}>
          <Text style={styles.subtitle}>Choose your vehicle</Text>
          <Text style={styles.typeCount}>{mockVehicleTypes.length} types</Text>
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
                compact
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
      </View>

      {/* Bottom CTA */}
      <View style={styles.footer}>
        <View style={styles.fareSummary}>
          <Text style={styles.selectedName} numberOfLines={1}>{selectedVehicle?.name.split(' /')[0] ?? 'Choose a vehicle'}</Text>
          <Text style={styles.selectedFare}>{selectedQuoteState?.isLoading ? 'Calculating...' : selectedQuote && isSelectedQuoteValid ? formatFare(selectedQuote.payablePaise) : isSelectedQuoteOnRequest ? 'Quote on request' : 'Fare unavailable'}</Text>
        </View>
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
            if (route?.params?.returnToReview) {
              if (navigation?.replace) navigation.replace('ReviewBookingScreen');
              else navigation?.navigate('ReviewBookingScreen');
            } else navigation?.navigate('GoodsDetailsScreen');
          }}
        >
          <Text style={styles.ctaLabel}>
            Continue
          </Text>
          <Feather name="arrow-right" size={spacing.xl} color={colors.onPrimary} />
        </Pressable>
      </View>
        </>
      )}
      <Pressable style={[styles.floatingBack, { top: safeInsets.top + spacing.sm }]} accessibilityRole="button" accessibilityLabel="Navigate back" onPress={() => onBack ? onBack() : navigation?.goBack()}><Feather name="arrow-left" size={spacing.xl} color={colors.primary} /></Pressable>
      <Modal visible={fullRouteOpen} transparent animationType="slide" onRequestClose={() => setFullRouteOpen(false)} testID="full-route-modal">
        <View style={styles.modalContainer}>
          <Pressable style={styles.routeBackdrop} accessibilityRole="button" accessibilityLabel="Close full route" onPress={() => setFullRouteOpen(false)} />
          <View style={[styles.fullRouteSheet, { paddingBottom: Math.max(safeInsets.bottom, spacing.lg) }]} accessibilityViewIsModal>
            <View style={styles.sheetHandle} />
            <View style={styles.fullRouteHeader}>
              <View><Text style={styles.fullRouteTitle} accessibilityRole="header">Full route</Text><Text style={styles.typeCount}>Pickup to {draft.drops.length} {draft.drops.length === 1 ? 'drop' : 'drops'}</Text></View>
              <Pressable accessibilityRole="button" accessibilityLabel="Close route details" onPress={() => setFullRouteOpen(false)} style={styles.closeRoute}><Feather name="x" size={spacing.xl} color={colors.primary} /></Pressable>
            </View>
            <ScrollView style={styles.fullRouteScroll} contentContainerStyle={styles.fullRouteContent} showsVerticalScrollIndicator>
              <View style={styles.fullRouteRow}>
                <View style={styles.routeTimeline}><View style={styles.dotGreen} />{draft.drops.length > 0 && <View style={styles.timelineLine} />}</View>
                <View style={styles.fullAddressText}><Text style={[styles.routeItemTitle, styles.pickupLabel]}>PICKUP</Text><Text style={styles.fullAddress} testID="full-pickup-address">{draft.pickup?.address || 'Pickup location not selected'}</Text></View>
              </View>
              {draft.drops.map((drop, index) => <View style={styles.fullRouteRow} key={`full-drop-${index}`}>
                <View style={styles.routeTimeline}><View style={styles.dropNumber}><Text style={styles.dropNumberText}>{index + 1}</Text></View>{index < draft.drops.length - 1 && <View style={styles.timelineLine} />}</View>
                <View style={styles.fullAddressText}><Text style={styles.routeItemTitle}>DROP {index + 1}</Text><Text style={styles.fullAddress} testID={`full-drop-address-${index}`}>{drop.address}</Text></View>
              </View>)}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  pickupLabel: { color: colors.statusGreen },
  routeCardHeader: { flexDirection: 'row', justifyContent: 'flex-end' },
  floatingBack: { position: 'absolute', left: spacing.lg, zIndex: 50, width: spacing.rowHeightSm + spacing.xs, height: spacing.rowHeightSm + spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  previewNotice: { position: 'absolute', bottom: spacing.sm, left: spacing.md, backgroundColor: colors.surface, borderRadius: borderRadius.md, padding: spacing.sm },
  previewNoticeText: { ...typography.labelSm, color: colors.onSurfaceVariant },
  fullRouteAction: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: spacing.xxxl, paddingLeft: spacing.md },
  fullRouteActionText: { ...typography.labelSm, color: colors.homeAction, fontWeight: '600' },
  modalContainer: { flex: 1, justifyContent: 'flex-end' },
  routeBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black + '66' },
  fullRouteSheet: { maxHeight: '80%', backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl, paddingHorizontal: spacing.lg },
  fullRouteHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.lg },
  fullRouteTitle: { ...typography.headlineMd, color: colors.primary },
  closeRoute: { width: spacing.rowHeightSm + spacing.xs, height: spacing.rowHeightSm + spacing.xs, alignItems: 'center', justifyContent: 'center' },
  fullRouteScroll: { flexShrink: 1 },
  fullRouteContent: { paddingBottom: spacing.lg },
  fullRouteRow: { flexDirection: 'row', minHeight: spacing.rowHeightStandard },
  fullAddressText: { flex: 1, minWidth: 0, paddingVertical: spacing.sm },
  fullAddress: { ...typography.bodyMd, color: colors.primary, marginTop: spacing.xs },
  selectionSheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl },
  sheetHandle: { width: spacing.xxxl, height: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.outlineVariant, alignSelf: 'center', marginTop: spacing.sm },
  dropNumber: { marginTop: spacing.sm, width: spacing.xl, height: spacing.xl, borderRadius: borderRadius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  dropNumberText: { ...typography.labelSm, color: colors.onPrimary },
  typeCount: { ...typography.labelSm, color: colors.statusGreen, backgroundColor: colors.selectionTint, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: borderRadius.full },
  fareSummary: { flex: 1, minWidth: 0 },
  selectedName: { ...typography.labelSm, color: colors.onSurfaceVariant },
  selectedFare: { ...typography.headlineSm, color: colors.onSuccessContainer },
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  backIcon: {
    fontSize: 22,
    color: colors.onSurface,
  },
  helpText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },
  addressScrollContent: { paddingRight: spacing.sm },
  routeSummaryCard: {
    backgroundColor: colors.surfaceBright,
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
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
    backgroundColor: colors.homePickup,
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
    minWidth: 0,
    paddingRight: spacing.lg,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  routeItemTitle: {
    ...typography.labelCaps,
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  routeItemAddress: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: '500',
    marginTop: spacing.xs,
  },
  routeActions: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  routeActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: spacing.xxxl,
  },
  routeActionText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.homeAction,
    fontFamily: typography.labelSm.fontFamily,
    fontWeight: '600',
  },
  routeActionDivider: {
    width: 1,
    backgroundColor: colors.outlineHairline,
  },
  subtitleContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.md,
    paddingTop: spacing.xs,
  },
  subtitle: {
    ...typography.headlineSm,
    color: colors.primary,
    fontFamily: typography.bodyLg.fontFamily,
  },
  vehicleList: {
    gap: spacing.sm,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
  footerContent: {
    flex: 1,
    gap: spacing.md,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.homeAction,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
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
