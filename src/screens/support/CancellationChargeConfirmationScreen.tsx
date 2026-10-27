import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useBooking } from '../../state/BookingContext';
import {
  getCancellationEstimate,
  executeTripCancellation,
  formatCurrency,
} from '../../services/cancellationService';
import { toApiError } from '../../api/http';

export interface CancellationChargeConfirmationScreenProps {
  readonly feeAmount?: string;
  readonly policyText?: string;
  readonly onCancelAccept?: () => void;
  readonly onKeepTrip?: () => void;
}

const CancellationChargeConfirmationScreen: React.FC<
  CancellationChargeConfirmationScreenProps & { navigation?: any; route?: any }
> = ({
  feeAmount: propFeeAmount,
  policyText: propPolicyText,
  onCancelAccept,
  onKeepTrip,
  navigation,
  route,
}) => {
  const {
    trip: contextTrip,
    ride: contextRide,
    draft,
    assignedDriver: contextDriver,
    customerId,
    setTrip,
  } = useBooking();

  const [isCancelling, setIsCancelling] = useState(false);
  const isCancellingRef = useRef(false);

  const activeTrip = route?.params?.trip || contextTrip;
  const activeRide = route?.params?.ride || contextRide;
  const activeDriver = route?.params?.assignedDriver || contextDriver;
  const reason = route?.params?.reason || 'Customer cancelled booking';

  const estimate = useMemo(() => {
    return getCancellationEstimate({
      trip: activeTrip,
      ride: activeRide,
      draft,
      assignedDriver: activeDriver,
    });
  }, [activeTrip, activeRide, draft, activeDriver]);

  const effectiveFee =
    propFeeAmount || route?.params?.feeAmount || estimate.formattedFee;
  const effectivePolicy =
    propPolicyText ||
    route?.params?.policyText ||
    'A cancellation fee applies because the driver is close to your pickup location, as per the current cancellation policy.';

  const handleCancelAndAccept = async () => {
    if (isCancellingRef.current) return;
    isCancellingRef.current = true;
    setIsCancelling(true);

    try {
      const result = await executeTripCancellation({
        trip: activeTrip,
        ride: activeRide,
        customerId,
        reason,
      });

      if (activeTrip && setTrip) {
        setTrip({ ...activeTrip, status: 'CANCELLED' });
      }

      onCancelAccept?.();

      navigation?.navigate('CancellationResultScreen', {
        tripId: result.tripId || estimate.tripReference,
        feeAmount: result.feeAmount || estimate.formattedFee,
        cancelledTrip: result.cancelledTrip,
      });
    } catch (err: unknown) {
      const apiErr = toApiError(err);
      Alert.alert(
        'Cancellation Error',
        apiErr.userMessage || 'Could not cancel booking. Please try again.'
      );
    } finally {
      isCancellingRef.current = false;
      setIsCancelling(false);
    }
  };

  const pickupAddress =
    route?.params?.pickupAddress ||
    draft?.pickup?.address ||
    activeRide?.pickup?.address ||
    activeTrip?.pickup?.address ||
    (activeTrip?.stops && activeTrip.stops[0]?.address) ||
    'Pickup Location';

  const dropAddress =
    route?.params?.dropAddress ||
    draft?.drops?.[0]?.address ||
    activeRide?.drop?.address ||
    (activeTrip?.stops && activeTrip.stops.find((s: any) => s.type !== 'pickup')?.address) ||
    'Drop Location';

  const driverName =
    activeDriver?.name ||
    (activeTrip as any)?.driverName ||
    (activeTrip as any)?.driver?.name ||
    (activeRide as any)?.driverName;

  const vehicleInfo =
    activeDriver?.vehicleType ||
    activeTrip?.vehicleType ||
    activeRide?.vehicleType ||
    draft?.vehicleType;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Background Dim (Simulating modal overlay) */}
      <View style={styles.backdrop} />

      {/* Modal Container */}
      <View style={styles.sheetContainer}>
        {/* Drag Handle Indicator */}
        <View style={styles.dragHandleContainer}>
          <View style={styles.dragHandle} />
        </View>

        <View style={styles.contentPadding}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.warningIconBox}>
              <MaterialIcons name="warning" size={24} color={colors.error} />
            </View>
            <View style={styles.headerTexts}>
              <View style={styles.headerTitleRow}>
                <Text style={styles.headerTitle}>Cancel this trip?</Text>
                <View style={styles.tripIdBadge}>
                  <Text style={styles.tripIdText}>{estimate.tripReference}</Text>
                </View>
              </View>
              <Text style={styles.headerSubtitle}>Cancellation Policy & Charges</Text>
            </View>
          </View>

          {/* Real Trip Context Card */}
          <View style={styles.tripContextCard}>
            <View style={styles.routeRow}>
              <View style={styles.routeDotCol}>
                <View style={[styles.routeDot, styles.pickupDot]} />
                <View style={styles.routeLine} />
                <View style={[styles.routeDot, styles.dropDot]} />
              </View>
              <View style={styles.routeTextCol}>
                <View style={styles.routePoint}>
                  <Text style={styles.routePointLabel}>PICKUP</Text>
                  <Text style={styles.routePointText} numberOfLines={1}>
                    {pickupAddress}
                  </Text>
                </View>
                <View style={[styles.routePoint, { marginTop: 10 }]}>
                  <Text style={styles.routePointLabel}>DROP</Text>
                  <Text style={styles.routePointText} numberOfLines={1}>
                    {dropAddress}
                  </Text>
                </View>
              </View>
            </View>

            {(driverName || vehicleInfo) && (
              <View style={styles.driverTagRow}>
                <MaterialIcons name="local-shipping" size={14} color={colors.onSurfaceVariant} />
                <Text style={styles.driverTagText}>
                  {driverName ? `${driverName} • ` : ''}{vehicleInfo || 'Mini Truck'}
                </Text>
              </View>
            )}
          </View>

          {/* Charge Breakdown Card */}
          <View style={styles.chargeCard}>
            {estimate.originalFare > 0 && (
              <View style={styles.breakdownRow}>
                <Text style={styles.breakdownLabel}>Original Trip Fare</Text>
                <Text style={styles.breakdownValue}>{formatCurrency(estimate.originalFare)}</Text>
              </View>
            )}
            <View style={styles.feeRow}>
              <View>
                <Text style={styles.feeLabel}>Cancellation Charge</Text>
                <Text style={styles.feeSub}>25% fee (driver dispatched)</Text>
              </View>
              <Text style={styles.feeValue}>{effectiveFee}</Text>
            </View>
            <View style={styles.divider} />
            <Text style={styles.policyText}>{effectivePolicy}</Text>
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            <Pressable
              style={[styles.customButton, styles.cancelButton, isCancelling && { opacity: 0.7 }]}
              onPress={handleCancelAndAccept}
              disabled={isCancelling}
              accessibilityRole="button"
            >
              {isCancelling ? (
                <ActivityIndicator size="small" color={colors.onError} />
              ) : (
                <Text style={styles.cancelButtonText}>CANCEL & ACCEPT CHARGE</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.customButton, styles.keepButton]}
              onPress={() => (onKeepTrip ? onKeepTrip() : navigation?.goBack())}
              disabled={isCancelling}
              accessibilityRole="button"
            >
              <Text style={styles.keepButtonText}>KEEP TRIP</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.inverseSurface + 'CC',
  },
  sheetContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...shadows.card,
    elevation: 24,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    width: 48,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },
  contentPadding: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  warningIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  headerTexts: {
    flex: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  tripIdBadge: {
    backgroundColor: colors.surfaceContainerHigh,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  tripIdText: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
  },
  headerSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  tripContextCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    marginBottom: spacing.md,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  routeDotCol: {
    alignItems: 'center',
    width: 14,
    paddingTop: 3,
  },
  routeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pickupDot: {
    backgroundColor: colors.statusGreen,
  },
  dropDot: {
    backgroundColor: colors.error,
  },
  routeLine: {
    width: 1.5,
    height: 20,
    backgroundColor: colors.outlineVariant,
    marginVertical: 2,
  },
  routeTextCol: {
    flex: 1,
  },
  routePoint: {
    justifyContent: 'center',
  },
  routePointLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  routePointText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontWeight: '500',
    marginTop: 1,
  },
  driverTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
  },
  driverTagText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontWeight: '500',
  },
  chargeCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    marginBottom: spacing.xl,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  breakdownLabel: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
  },
  breakdownValue: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  feeLabel: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  feeSub: {
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    marginTop: 2,
  },
  feeValue: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.error,
    fontFamily: typography.headlineMd.fontFamily,
  },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    marginVertical: spacing.md,
  },
  policyText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    lineHeight: 22,
  },
  actionsContainer: {
    gap: spacing.md,
  },
  customButton: {
    height: spacing.rowHeightStandard,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  cancelButton: {
    backgroundColor: colors.error,
  },
  cancelButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onError,
    fontFamily: typography.headlineSm.fontFamily,
  },
  keepButton: {
    backgroundColor: colors.secondaryContainer,
  },
  keepButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default CancellationChargeConfirmationScreen;
