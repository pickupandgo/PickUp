import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { useRideOtps } from '../../hooks/useRideOtps';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useBooking } from '../../state/BookingContext';

export interface DropOtpVerificationScreenProps {
  readonly onBack?: () => void;
}

/**
 * Customer-facing delivery verification is display-only. The engine releases this OTP only
 * after the payment backend opens the current drop's gate, and the driver verifies it with the
 * engine. A customer can never locally mark a drop as delivered.
 */
const DropOtpVerificationScreen: React.FC<DropOtpVerificationScreenProps & { navigation?: any }> = ({
  onBack,
  navigation,
}) => {
  const { ride, trip, setTrip } = useBooking();
  const { trip: polledTrip, error: tripError } = useTripStatus(trip?.id, { enabled: Boolean(trip?.id) });
  const currentTrip = polledTrip ?? trip;
  const { otps, error: otpError, refresh } = useRideOtps(ride?.id, {
    enabled: Boolean(ride?.id && currentTrip?.currentStop),
  });

  React.useEffect(() => {
    if (polledTrip) setTrip(polledTrip);
  }, [polledTrip, setTrip]);

  const stop = currentTrip?.currentStop;
  const stopOtp = stop ? otps?.stops.find((candidate) => candidate.sequence === stop.sequence) : undefined;
  const code = stopOtp?.otp ?? null;
  const isFinished = stop?.status === 'DELIVERED' || currentTrip?.status === 'COMPLETED';
  const message = tripError?.userMessage ?? otpError?.userMessage;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())} accessibilityRole="button">
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Delivery Verification</Text>
        <View style={styles.iconButton} />
      </View>

      <View style={styles.content}>
        <View style={styles.contextCard}>
          <Text style={styles.dropBadgeText}>
            {stop ? `DROP ${stop.sequence} OF ${currentTrip?.totalStops ?? currentTrip?.stops.length ?? 1}` : 'DELIVERY'}
          </Text>
          <Text style={styles.dropAddress}>{stop?.location.address ?? 'Delivery location'}</Text>
          {stop?.receiver?.name ? <Text style={styles.contactText}>{stop.receiver.name}</Text> : null}
        </View>

        <View style={styles.otpSection}>
          <Text style={styles.otpTitle}>Delivery OTP</Text>
          {isFinished ? (
            <Text style={styles.subtitle}>This delivery has already been confirmed by the engine.</Text>
          ) : code ? (
            <>
              <Text style={styles.subtitle}>Share this server-issued code with the driver to confirm handover.</Text>
              <Text style={styles.otpCode} accessibilityLabel="Delivery OTP">{code}</Text>
            </>
          ) : (
            <Text style={styles.subtitle}>
              {stopOtp?.withheld === 'PAYMENT_REQUIRED'
                ? 'The delivery OTP will be available after payment for this drop is confirmed.'
                : 'Waiting for the engine to release the delivery OTP.'}
            </Text>
          )}
          {message ? <Text style={styles.errorText}>{message}</Text> : null}
        </View>
      </View>

      <View style={styles.actionContainer}>
        <Pressable style={styles.refreshButton} onPress={refresh} accessibilityRole="button">
          <Text style={styles.refreshButtonText}>REFRESH STATUS</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, height: spacing.rowHeightStandard },
  iconButton: { width: 40, height: 40, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: typography.headlineSm.fontSize, fontWeight: '700', color: colors.primary, fontFamily: typography.headlineSm.fontFamily },
  content: { paddingHorizontal: spacing.marginMobile, paddingTop: spacing.lg },
  contextCard: { backgroundColor: colors.surfaceContainerLow, borderRadius: borderRadius.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.outlineVariant + '4D', marginBottom: spacing.xxl, ...shadows.card },
  dropBadgeText: { fontSize: typography.labelCaps.fontSize, fontWeight: typography.labelCaps.fontWeight, color: colors.primary, fontFamily: typography.labelCaps.fontFamily, letterSpacing: typography.labelCaps.letterSpacing, marginBottom: spacing.sm },
  dropAddress: { fontSize: typography.headlineMd.fontSize, fontWeight: typography.headlineMd.fontWeight, color: colors.onSurface, fontFamily: typography.headlineMd.fontFamily },
  contactText: { fontSize: typography.bodyMd.fontSize, color: colors.onSurfaceVariant, fontFamily: typography.bodyMd.fontFamily, marginTop: spacing.xs },
  otpSection: { alignItems: 'center', paddingHorizontal: spacing.md },
  otpTitle: { fontSize: typography.headlineMd.fontSize, fontWeight: typography.headlineMd.fontWeight, color: colors.onSurface, fontFamily: typography.headlineMd.fontFamily, marginBottom: spacing.sm },
  subtitle: { fontSize: typography.bodyMd.fontSize, color: colors.onSurfaceVariant, fontFamily: typography.bodyMd.fontFamily, textAlign: 'center', maxWidth: 300 },
  otpCode: { fontSize: 36, letterSpacing: 10, fontWeight: '700', color: colors.primary, fontFamily: typography.dataMono.fontFamily, marginTop: spacing.xl },
  errorText: { color: colors.error, fontSize: typography.bodyMd.fontSize, fontFamily: typography.bodyMd.fontFamily, textAlign: 'center', marginTop: spacing.md },
  actionContainer: { marginTop: 'auto', paddingHorizontal: spacing.marginMobile, paddingBottom: spacing.xl },
  refreshButton: { height: 52, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  refreshButtonText: { color: colors.primary, fontSize: typography.labelCaps.fontSize, fontWeight: typography.labelCaps.fontWeight, fontFamily: typography.labelCaps.fontFamily },
});

export default DropOtpVerificationScreen;

