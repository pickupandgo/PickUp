import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useSelectedTrip } from '../../hooks/useSelectedTrip';
import { useBookingPayment } from '../../hooks/useBookingPayment';
import BookingPaymentStatus from '../../components/organisms/BookingPaymentStatus';
import { formatPaise, paymentLabel } from '../../utils/paymentPresentation';
import { useBooking } from '../../state/BookingContext';
import { getVehicleDisplayName } from '../../utils/vehicleAssets';

export interface TripCompletedSummaryScreenProps {
  readonly onBack?: () => void;
  readonly onMore?: () => void;
  readonly onRateDriver?: () => void;
  readonly onViewReceipt?: () => void;
  readonly onBackToHome?: () => void;
  readonly navigation?: any;
  readonly route?: any;
}

const TripCompletedSummaryScreen: React.FC<TripCompletedSummaryScreenProps & { navigation?: any; route?: any }> = ({
  onBack,
  onMore,
  onRateDriver,
  onViewReceipt,
  onBackToHome,
  navigation,
  route,
}) => {
  const context = useBooking();
  const trip = useSelectedTrip(route?.params, context.trip);
  const explicit = !!route?.params && ('trip' in route.params || 'tripId' in route.params || 'paymentBookingId' in route.params);
  const scoped = !explicit || (!!trip && trip.id === context.trip?.id);
  const ride = scoped ? context.ride : undefined;
  const draft = { drops: [] } as typeof context.draft;
  const assignedDriver = scoped ? context.assignedDriver : undefined;
  const clearActiveRide = () => { if (trip?.id === context.trip?.id && ['COMPLETED', 'CANCELLED'].includes(trip?.status ?? '')) context.clearActiveRide(); };
  const payment = useBookingPayment(trip?.paymentBookingId ?? ride?.paymentBookingId);
  const selected = { trip, tripId: trip?.id, paymentBookingId: trip?.paymentBookingId };
  const phase = trip?.status === 'COMPLETED' ? 'Trip completed' : trip?.status === 'DELIVERED' ? 'Finalizing trip' : trip?.status === 'CANCELLED' ? 'Trip cancelled' : 'Trip status unavailable';


  // 1. Route Stops
  const stops = useMemo(() => {
    // 1. Try trip
    if (trip?.pickup?.address || (trip?.stops && trip.stops.length > 0)) {
      const list: Array<{ label: string; address: string }> = [];
      const pickupAddr = trip.pickup?.address || draft.pickup?.address;
      if (pickupAddr) {
        list.push({ label: 'Pickup', address: pickupAddr });
      }
      if (trip.stops && trip.stops.length > 0) {
        trip.stops.forEach((s, i) => {
          const isSingle = trip.stops.length === 1;
          const isLast = i === trip.stops.length - 1;
          const label = isSingle ? 'Final Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
          list.push({
            label,
            address: s.location?.address || `Drop Location ${i + 1}`,
          });
        });
      } else if (trip.drop?.address) {
        list.push({ label: 'Final Drop', address: trip.drop.address });
      }
      if (list.length >= 2) return list;
    }

    // 2. Try ride
    const rideDrops = ride?.drops;
    if (ride?.pickup?.address || (rideDrops && rideDrops.length > 0)) {
      const list: Array<{ label: string; address: string }> = [];
      const pickupAddr = ride.pickup?.address || draft.pickup?.address;
      if (pickupAddr) {
        list.push({ label: 'Pickup', address: pickupAddr });
      }
      if (rideDrops && rideDrops.length > 0) {
        rideDrops.forEach((d, i) => {
          const isSingle = rideDrops.length === 1;
          const isLast = i === rideDrops.length - 1;
          const label = isSingle ? 'Final Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
          list.push({
            label,
            address: d.address || `Drop Location ${i + 1}`,
          });
        });
      } else if (ride.drop?.address) {
        list.push({ label: 'Final Drop', address: ride.drop.address });
      }
      if (list.length >= 2) return list;
    }

    // 3. Try draft
    if (draft.pickup?.address && draft.drops && draft.drops.length > 0) {
      const list: Array<{ label: string; address: string }> = [
        { label: 'Pickup', address: draft.pickup.address },
      ];
      draft.drops.forEach((d, i) => {
        const isSingle = draft.drops.length === 1;
        const isLast = i === draft.drops.length - 1;
        const label = isSingle ? 'Final Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
        list.push({
          label,
          address: d.address,
        });
      });
      return list;
    }

    return [];
  }, [trip, ride, draft]);

  // 2. Vehicle Summary
  const displayVehicleSummary = useMemo(() => {
    const rawType =
      route?.params?.vehicleType ||
      assignedDriver?.vehicleType ||
      (trip as any)?.vehicleType ||
      ride?.vehicleType ||
      draft.vehicleType;
    const vName = getVehicleDisplayName(rawType);
    const vNumber =
      route?.params?.vehicleNumber ||
      (assignedDriver as any)?.vehicleNumber ||
      (assignedDriver as any)?.vehicleRegistrationNumber ||
      (trip as any)?.vehicleNumber ||
      (ride as any)?.vehicleNumber ||
      'Not available';
    return `${vName} | ${vNumber}`;
  }, [route?.params, assignedDriver, trip, ride, draft.vehicleType]);

  // 3. Completion Time
  const displayCompletionTime = trip?.completedAt && Number.isFinite(Date.parse(trip.completedAt))
    ? new Date(trip.completedAt).toLocaleString('en-IN') : 'Not available';

  // 4. Payment Status
  const displayPaymentStatus = paymentLabel(payment.booking);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
          >
            <Feather name="arrow-left" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>{phase}</Text>
          <Pressable
            style={styles.iconButton}
            onPress={() =>
              onMore ? onMore() : scoped ? navigation?.navigate('ShareTrackingSheetScreen') : undefined
            }
          >
            <Feather name="more-vertical" size={24} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.headerDivider} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <BookingPaymentStatus state={payment} />
        {trip?.stops?.map(stop => <Text key={`outcome-${stop.sequence}`}>Drop {stop.sequence}: {stop.status.replace(/_/g, ' ').toLowerCase()}</Text>)}
        {/* Success Banner */}
        <View style={styles.successBanner}>
          <Feather name={trip?.status === 'COMPLETED' ? 'check-circle' : 'clock'} size={24} color={colors.onSuccessContainer} />
          <Text style={styles.successBannerText}>{phase}</Text>
        </View>

        {/* High Fidelity Card */}
        <View style={styles.card}>
          {/* Timeline */}
          <View style={styles.timelineContainer}>
            <View style={styles.timelineLine} />
            
            {stops.map((stop, index) => {
              const isFirst = index === 0;
              const isLast = index === stops.length - 1;
              const isPrimaryNode = isFirst || isLast;
              
              let stopLabel = 'DROP';
              if (isFirst) stopLabel = 'PICKUP';
              else if (isLast) stopLabel = stops.length > 2 ? 'FINAL DROP' : 'FINAL DROP';
              else stopLabel = `DROP ${index}`;

              return (
                <View key={index} style={styles.timelineRow}>
                  {/* Node Connector */}
                  <View style={styles.nodeContainer}>
                    {isPrimaryNode ? (
                      <View style={styles.primaryNodeRing}>
                        <View style={styles.primaryNodeCore} />
                      </View>
                    ) : (
                      <View style={styles.secondaryNode} />
                    )}
                  </View>
                  
                  {/* Content */}
                  <View style={styles.contentColumn}>
                    <Text style={styles.stopLabelCaps}>{stopLabel}</Text>
                    <Text style={isPrimaryNode ? styles.stopAddressLg : styles.stopAddressMd}>
                      {stop.address.split(',')[0]}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.cardDivider} />

          {/* Details Grid */}
          <View style={styles.gridContainer}>
            <View style={styles.gridItemHalf}>
              <Text style={styles.gridLabel}>Vehicle</Text>
              <Text style={styles.gridValueMono}>
                {displayVehicleSummary}
              </Text>
            </View>
            <View style={styles.gridItemHalf}>
              <Text style={styles.gridLabel}>Completion Time</Text>
              <Text style={styles.gridValueMono}>{displayCompletionTime}</Text>
            </View>
            <View style={styles.gridItemFull}>
              <Text style={styles.gridLabel}>Payment Status</Text>
              <View style={styles.paymentStatusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.gridValueMono}>{displayPaymentStatus}</Text>
              </View>
            </View>
          </View>

          {/* Receipt Info */}
          <View style={styles.receiptInfoBox}>
            <Feather name="file-text" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.receiptInfoText}>Digital receipt is now available.</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionContainer}>
          <Pressable
            style={styles.rateButton}
            onPress={() =>
              onRateDriver ? onRateDriver() : navigation?.navigate('DriverRatingScreen', selected)
            }
          >
            <Feather name="star" size={20} color={colors.onPrimary} />
            <Text style={styles.rateButtonText}>RATE DRIVER</Text>
          </Pressable>
          
          <Pressable
            style={styles.receiptButton}
            onPress={() =>
              onViewReceipt ? onViewReceipt() : navigation?.navigate('BookingStack', { screen: 'DigitalReceiptScreen', params: selected })
            }
          >
            <Feather name="file-text" size={20} color={colors.onSecondaryContainer} />
            <Text style={styles.receiptButtonText}>VIEW RECEIPT</Text>
          </Pressable>
          
          <Pressable
            style={styles.homeButton}
            onPress={() => {
              clearActiveRide();
              if (onBackToHome) onBackToHome();
              else (navigation?.getParent?.() ?? navigation)?.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
            }}
          >
            <Text style={styles.homeButtonText}>BACK TO HOME</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    zIndex: 40,
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
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainerLow,
    width: '100%',
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },

  // Success Banner
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successContainer,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  successBannerText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSuccessContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },

  // Card
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    ...shadows.card,
    gap: spacing.xl,
  },
  timelineContainer: {
    paddingLeft: spacing.lg,
    position: 'relative',
    gap: spacing.xl,
  },
  timelineLine: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: colors.surfaceContainer,
  },
  timelineRow: {
    position: 'relative',
  },
  nodeContainer: {
    position: 'absolute',
    left: -spacing.lg - 8, // Offset to center on the timeline line
    top: 4,
    width: 16,
    alignItems: 'center',
  },
  primaryNodeRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surfaceContainerLowest,
  },
  primaryNodeCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  secondaryNode: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.outline,
    marginTop: 2, // optical alignment
  },
  contentColumn: {},
  stopLabelCaps: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: 4,
  },
  stopAddressLg: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  stopAddressMd: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },

  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainer,
  },

  // Details Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItemHalf: {
    width: '48%',
    marginBottom: spacing.sm,
  },
  gridItemFull: {
    width: '100%',
  },
  gridLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 4,
  },
  gridValueMono: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  paymentStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.successContainer,
  },

  // Receipt Info
  receiptInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceVariant,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  receiptInfoText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Actions
  actionContainer: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 48,
    borderRadius: borderRadius.full,
  },
  rateButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  receiptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryContainer,
    height: 48,
    borderRadius: borderRadius.full,
  },
  receiptButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
  homeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    marginTop: spacing.xs,
  },
  homeButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default TripCompletedSummaryScreen;
