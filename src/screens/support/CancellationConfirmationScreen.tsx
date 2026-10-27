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
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Button from '../../components/atoms/Button';
import { useBooking } from '../../state/BookingContext';
import {
  getCancellationEstimate,
  executeTripCancellation,
} from '../../services/cancellationService';
import { toApiError } from '../../api/http';

export interface CancellationConfirmationScreenProps {
  readonly trip?: any;
  readonly ride?: any;
  readonly eta?: string;
  readonly vehicleInfo?: string;
  readonly cancelFee?: string;
  readonly feeNote?: string;
  readonly policyText?: string;
  readonly onCancelTrip?: () => void;
  readonly onKeepTrip?: () => void;
  readonly onClose?: () => void;
}

const CancellationConfirmationScreen: React.FC<
  CancellationConfirmationScreenProps & { navigation?: any; route?: any }
> = ({
  trip: propTrip,
  ride: propRide,
  eta: propEta,
  vehicleInfo: propVehicleInfo,
  cancelFee: propCancelFee,
  feeNote: propFeeNote,
  policyText: propPolicyText,
  onCancelTrip,
  onKeepTrip,
  onClose,
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

  const activeTrip = propTrip || route?.params?.trip || contextTrip;
  const activeRide = propRide || route?.params?.ride || contextRide;
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

  const effectiveEta = propEta || route?.params?.eta || estimate.etaText;
  const effectiveVehicleInfo =
    propVehicleInfo || route?.params?.vehicleInfo || estimate.vehicleInfo;
  const effectiveCancelFee =
    propCancelFee || route?.params?.cancelFee || estimate.formattedFee;
  const effectiveFeeNote =
    propFeeNote ||
    route?.params?.feeNote ||
    `(${estimate.percentage}% of fare)`;
  const effectivePolicy =
    propPolicyText ||
    route?.params?.policyText ||
    "A cancellation fee may apply based on the driver's proximity to the pickup. Charges are determined by the current cancellation policy.";

  const handleCancelTrip = async () => {
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

      onCancelTrip?.();

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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Background Dim (Simulating modal) */}
      <View style={styles.backdrop} />

      {/* Bottom Sheet Content */}
      <View style={styles.sheetContainer}>
        {/* Drag Handle Indicator */}
        <View style={styles.dragHandleContainer}>
          <View style={styles.dragHandle} />
        </View>

        <View style={styles.contentPadding}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Cancel Trip?</Text>
            <Pressable
              style={styles.closeButton}
              onPress={() => (onClose ? onClose() : navigation?.goBack())}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Feather name="x" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          </View>

          {/* Trip Context */}
          <View style={styles.contextCard}>
            <View style={styles.vehicleIconBox}>
              <MaterialIcons
                name={estimate.vehicleIconName as any}
                size={24}
                color={colors.onSecondaryContainer}
              />
            </View>
            <View style={styles.contextTexts}>
              <Text style={styles.etaText}>{effectiveEta}</Text>
              <Text style={styles.vehicleText}>{effectiveVehicleInfo}</Text>
            </View>
          </View>

          {/* Warning Box */}
          <View style={styles.warningBox}>
            <View style={styles.warningHeader}>
              <MaterialIcons
                name="warning"
                size={20}
                color={colors.error}
                style={styles.warningIcon}
              />
              <View style={styles.warningTexts}>
                <Text style={styles.warningTitle}>
                  Estimated Cancellation Fee: {effectiveCancelFee}
                </Text>
                <Text style={styles.warningSubtitle}>{effectiveFeeNote}</Text>
              </View>
            </View>
            <View style={styles.policyBox}>
              <Text style={styles.policyText}>{effectivePolicy}</Text>
            </View>
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            <Button
              label={isCancelling ? 'CANCELLING...' : 'CANCEL TRIP'}
              onPress={handleCancelTrip}
              variant="primary"
              fullWidth
              size="lg"
              disabled={isCancelling}
              style={styles.cancelButton}
              icon={
                isCancelling ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : undefined
              }
            />
            <Button
              label="KEEP TRIP"
              onPress={() => (onKeepTrip ? onKeepTrip() : navigation?.goBack())}
              variant="secondary"
              fullWidth
              size="lg"
              disabled={isCancelling}
              style={styles.keepButton}
            />
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface + 'B3',
  },
  sheetContainer: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xxl,
    borderTopRightRadius: borderRadius.xxl,
    overflow: 'hidden',
    paddingBottom: spacing.xxl,
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },
  contentPadding: {
    paddingHorizontal: spacing.marginMobile,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  vehicleIconBox: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  contextTexts: {
    flex: 1,
  },
  etaText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginBottom: 2,
  },
  vehicleText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  warningBox: {
    backgroundColor: colors.errorContainer + '33',
    borderColor: colors.errorContainer,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  warningHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  warningIcon: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  warningTexts: {
    flex: 1,
  },
  warningTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.error,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: 2,
  },
  warningSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  policyBox: {
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
  },
  policyText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  actionsContainer: {
    gap: spacing.md,
  },
  cancelButton: {
    backgroundColor: colors.error,
  },
  keepButton: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
});

export default CancellationConfirmationScreen;
