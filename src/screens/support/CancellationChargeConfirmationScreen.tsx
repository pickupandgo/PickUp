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
import { useI18n } from '../../i18n';
import { useBooking } from '../../state/BookingContext';
import {
  getCancellationEstimate,
  executeTripCancellation,
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
  const { t } = useI18n();
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
    t('cancellation.proximityPolicy');

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
              <Text style={styles.headerTitle}>{t('cancellation.cancelThisTripQuestion')}</Text>
              <Text style={styles.headerSubtitle}>{t('cancellation.cancellationCharge')}</Text>
            </View>
          </View>

          {/* Charge Breakdown Card */}
          <View style={styles.chargeCard}>
            <View style={styles.feeRow}>
              <Text style={styles.feeLabel}>{t('cancellation.feeAmount')}</Text>
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
                <Text style={styles.cancelButtonText}>{t('cancellation.cancelAndAcceptCharge')}</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.customButton, styles.keepButton]}
              onPress={() => (onKeepTrip ? onKeepTrip() : navigation?.goBack())}
              disabled={isCancelling}
              accessibilityRole="button"
            >
              <Text style={styles.keepButtonText}>{t('cancellation.keepTripCaps')}</Text>
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
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  headerSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  chargeCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    marginBottom: spacing.xl,
  },
  feeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  feeLabel: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  feeValue: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
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
