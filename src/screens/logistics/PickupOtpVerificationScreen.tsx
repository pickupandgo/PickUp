import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useBooking } from '../../state/BookingContext';
import { useTripStatus } from '../../hooks/useTripStatus';

export interface PickupOTPVerificationScreenProps {
  readonly pickupLocation?: string;
  readonly driverName?: string;
  readonly vehicleInfo?: string;
  readonly onVerify?: (otp: string) => void;
  readonly onResend?: () => void;
  readonly onBack?: () => void;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
}

const PickupOTPVerificationScreen: React.FC<PickupOTPVerificationScreenProps & { navigation?: any }> = ({
  pickupLocation = 'Sardarpura Warehouse',
  driverName = 'Ramesh Kumar',
  vehicleInfo = 'Tata Ace • RJ 19 XX 1234',
  onVerify,
  onResend,
  onBack,
  navigation,
  isLoading = false,
  isError = false,
}) => {
  const { trip, setTrip } = useBooking();

  // Poll the trip so the screen advances the moment the driver verifies.
  const { trip: polled, error: pollError } = useTripStatus(trip?.id, { intervalMs: 3_000 });

  useEffect(() => {
    if (polled) setTrip(polled);
  }, [polled, setTrip]);

  const current = polled ?? trip;
  const otpDigits = (current?.otp ?? '----').split('');
  const isVerified =
    current?.status === 'PICKUP_VERIFIED' ||
    current?.status === 'IN_TRANSIT' ||
    current?.status === 'DROP_PROGRESS';

  // React to whatever the driver just did. `replace` (not `navigate`) removes
  // this screen from the stack, so `useTripStatus` stops polling and later
  // status changes can't drive us forward a second time.
  useEffect(() => {
    const status = current?.status;
    if (status === 'DELIVERED' || status === 'COMPLETED') {
      navigation?.replace('TripCompletedScreen');
      return;
    }
    if (status === 'CANCELLED') {
      navigation?.replace('TripCancelledStatusScreen');
      return;
    }
    if (isVerified) {
      onVerify?.(current?.otp ?? '');
      navigation?.replace('PickupVerifiedSuccessScreen');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.status, isVerified]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Pickup Verification</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.mainContent}>
        {/* Trip Context Card */}
        <View style={styles.contextCard}>
          <View style={styles.locationRow}>
            <View style={styles.iconBox}>
              <MaterialIcons name="location-on" size={20} color={colors.primary} />
            </View>
            <View style={styles.locationTextContainer}>
              <Text style={styles.locationLabel}>Pickup Location</Text>
              <Text style={styles.locationValue}>{pickupLocation}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          <View style={styles.driverRow}>
            <View style={styles.driverAvatar}>
              <Feather name="user" size={24} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{driverName}</Text>
              <Text style={styles.vehicleInfo}>{vehicleInfo}</Text>
            </View>
            <View style={styles.ratingBadge}>
              <MaterialIcons name="star" size={14} color={colors.onSurfaceVariant} />
              <Text style={styles.ratingText}>4.8</Text>
            </View>
          </View>
        </View>

        {/* OTP Section — the engine issues the code to the customer, and the
            driver submits it, so this displays rather than collects. */}
        <View style={styles.otpSection}>
          <View style={styles.otpHeader}>
            <Text style={styles.otpTitle}>Share your OTP</Text>
            <Text style={styles.otpSubtitle}>
              Read this 4-digit code out to your driver. They enter it to confirm pickup.
            </Text>
          </View>

          <View style={styles.otpInputContainer}>
            {otpDigits.map((digit, index) => (
              <View key={`otp-${index}`} style={styles.otpDigitBox}>
                <Text style={styles.otpDigitText}>{digit}</Text>
              </View>
            ))}
          </View>

          <View style={styles.waitingRow}>
            <ActivityIndicator size="small" color={colors.onSurfaceVariant} />
            <Text style={styles.waitingText}>
              {isVerified ? 'Pickup verified' : 'Waiting for the driver to confirm…'}
            </Text>
          </View>

          {pollError && <Text style={styles.errorText}>{pollError.userMessage}</Text>}
        </View>
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
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  contextCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.card,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTextContainer: {
    flex: 1,
  },
  locationLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 4,
  },
  locationValue: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  divider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    opacity: 0.5,
    marginVertical: spacing.md,
  },
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  vehicleInfo: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  ratingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  ratingText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  otpSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.md,
  },
  otpHeader: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  otpTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.xs,
  },
  otpSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
  },
  otpInputContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    width: '100%',
    marginBottom: spacing.md,
  },
  otpDigitBox: {
    width: 56,
    height: 64,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpDigitText: {
    fontSize: 24,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  waitingText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  otpInputError: {
    borderColor: colors.error,
  },
  errorText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: spacing.sm,
  },
  actionsContainer: {
    gap: spacing.md,
    marginTop: 'auto',
  },
  resendBtn: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  resendText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textDecorationLine: 'underline',
  },
});

export default PickupOTPVerificationScreen;
