import React from 'react';
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
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Button from '../../components/atoms/Button';
import { useBooking } from '../../state/BookingContext';

export interface TripCancelledStatusScreenProps {
  readonly tripId?: string;
  readonly feeTitle?: string;
  readonly feeSubtitle?: string;
  readonly pickupLocation?: string;
  readonly pickupTime?: string;
  readonly dropLocation?: string;
  readonly cancelledAt?: string;
  readonly onHome?: () => void;
  readonly onViewHistory?: () => void;
  readonly onBack?: () => void;
}

const TripCancelledStatusScreen: React.FC<TripCancelledStatusScreenProps & { navigation?: any; route?: any }> = ({
  tripId: propTripId,
  feeTitle,
  feeSubtitle,
  pickupLocation: propPickupLocation,
  pickupTime: propPickupTime,
  dropLocation: propDropLocation,
  cancelledAt: propCancelledAt,
  onHome,
  onViewHistory,
  onBack,
  navigation,
  route,
}) => {
  const { clearActiveRide } = useBooking();

  const trip = route?.params?.trip;
  const effectiveTripId =
    route?.params?.tripId ||
    propTripId ||
    trip?.externalRef ||
    trip?.id ||
    'TRP-CANCELLED';

  const effectivePickup =
    route?.params?.pickupLocation ||
    trip?.pickup?.address ||
    propPickupLocation ||
    'Pickup Location';

  const effectivePickupTime =
    route?.params?.pickupTime ||
    propPickupTime ||
    (trip?.createdAt ? new Date(trip.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recent');

  const effectiveDrop =
    route?.params?.dropLocation ||
    trip?.drop?.address ||
    (trip?.stops?.[0]?.location?.address) ||
    propDropLocation ||
    'Drop Location';

  const effectiveCancelledAt =
    route?.params?.cancelledAt ||
    (trip?.cancelledAt
      ? `Cancelled on ${new Date(trip.cancelledAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${new Date(trip.cancelledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : propCancelledAt || 'Booking Cancelled');

  const feeAmount = route?.params?.feeAmount;
  const effectiveFeeTitle = feeTitle || (feeAmount ? 'Cancellation Charge' : 'No cancellation fee applies');
  const effectiveFeeSubtitle =
    feeSubtitle ||
    (feeAmount
      ? `A cancellation fee of ₹${feeAmount} has been charged to your account.`
      : 'You cancelled within the grace period. No payment was captured.');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip Cancelled</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        <View style={styles.statusCard}>
          <View style={styles.cancelIconBox}>
            <MaterialIcons name="cancel" size={40} color={colors.onErrorContainer} />
          </View>
          <Text style={styles.statusTitle}>Trip Cancelled</Text>
          <Text style={styles.statusSubtitle}>This booking has been successfully cancelled.</Text>
          <View style={styles.tripIdBadge}>
            <Text style={styles.tripIdText}>ID: {effectiveTripId}</Text>
          </View>
        </View>

        {/* Cancellation Charge Section */}
        <View style={styles.infoSection}>
          <View style={styles.infoRow}>
            <MaterialIcons name="info" size={20} color={colors.secondary} style={styles.infoIcon} />
            <View style={styles.infoTexts}>
              <Text style={styles.infoTitle}>{effectiveFeeTitle}</Text>
              <Text style={styles.infoSubtitle}>{effectiveFeeSubtitle}</Text>
            </View>
          </View>
        </View>

        {/* Trip Summary */}
        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Trip Summary</Text>
          
          <View style={styles.routeContainer}>
            <View style={styles.routeTimeline}>
              <MaterialIcons name="radio-button-checked" size={14} color={colors.primary} />
              <View style={styles.routeLine} />
              <MaterialIcons name="location-on" size={14} color={colors.primary} />
            </View>
            <View style={styles.routeDetails}>
              <View style={styles.pickupBlock}>
                <Text style={styles.locationText}>{effectivePickup}</Text>
                <Text style={styles.timeText}>{effectivePickupTime}</Text>
              </View>
              <View style={styles.dropBlock}>
                <Text style={styles.locationText}>{effectiveDrop}</Text>
              </View>
            </View>
          </View>

          <View style={styles.summaryFooter}>
            <Text style={styles.cancelledAtText}>{effectiveCancelledAt}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            label="Back to Home"
            onPress={() => {
              clearActiveRide();
              if (onHome) onHome();
              else navigation?.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
            }}
            variant="primary"
            fullWidth
            size="lg"
          />
          <Button
            label="View Trip History"
            onPress={() =>
              onViewHistory ? onViewHistory() : navigation?.navigate('TripHistoryScreen')
            }
            variant="secondary"
            fullWidth
            size="lg"
          />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
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
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  statusCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.xl,
    ...shadows.card,
  },
  cancelIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.errorContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statusTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.xs,
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  tripIdBadge: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  tripIdText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
  },
  infoSection: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 24,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  infoIcon: {
    marginTop: 2,
  },
  infoTexts: {
    flex: 1,
  },
  infoTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: 4,
  },
  infoSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  summarySection: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 24,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
  },
  sectionTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.md,
  },
  routeContainer: {
    flexDirection: 'row',
    marginBottom: spacing.md,
  },
  routeTimeline: {
    alignItems: 'center',
    marginRight: spacing.md,
    marginTop: 4,
  },
  routeLine: {
    width: 2,
    height: 24,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
  },
  routeDetails: {
    flex: 1,
  },
  pickupBlock: {
    marginBottom: spacing.md,
  },
  locationText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  timeText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  dropBlock: {
    justifyContent: 'center',
  },
  summaryFooter: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    paddingTop: spacing.md,
    marginTop: spacing.xs,
  },
  cancelledAtText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textAlign: 'right',
  },
  actionsContainer: {
    gap: spacing.md,
  },
});

export default TripCancelledStatusScreen;
