import BrandMark from '../../components/atoms/BrandMark';
import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { CommonActions } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Button from '../../components/atoms/Button';

import { useSelectedTrip } from '../../hooks/useSelectedTrip';
import { useBookingPayment } from '../../hooks/useBookingPayment';
import BookingPaymentStatus from '../../components/organisms/BookingPaymentStatus';
import { formatPaise, paymentLabel } from '../../utils/paymentPresentation';
import { useBooking } from '../../state/BookingContext';
import { getVehicleDisplayName } from '../../utils/vehicleAssets';

export interface DigitalReceiptScreenProps {
  readonly tripId?: string;
  readonly date?: string;
  readonly vehicle?: string;
  readonly baseFare?: string;
  readonly insurance?: string;
  readonly surcharges?: string;
  readonly totalAmount?: string;
  readonly paymentMethod?: string;
  readonly paymentStatus?: string;
  readonly onShareReceipt?: () => void;
  readonly onHome?: () => void;
  readonly onHelp?: () => void;
  readonly onBack?: () => void;
}

const DigitalReceiptScreen: React.FC<DigitalReceiptScreenProps & { navigation?: any; route?: any }> = ({
  tripId: requestedTripId, onShareReceipt, onHome, onHelp, onBack, navigation, route,
}) => {
  const context = useBooking();
  const params = route?.params ?? (requestedTripId ? { tripId: requestedTripId } : undefined);
  const trip = useSelectedTrip(params, context.trip);
  const explicit = !!params && ('trip' in params || 'tripId' in params || 'paymentBookingId' in params);
  const ride = !explicit ? context.ride : undefined;
  const payment = useBookingPayment(trip?.paymentBookingId ?? (!params?.tripId && !params?.trip ? params?.paymentBookingId : undefined) ?? ride?.paymentBookingId);
  const actualTotal = formatPaise(payment.booking?.farePaise);
  const actualTripId = trip?.externalRef ?? ride?.externalRef ?? payment.booking?.externalRef ?? trip?.id ?? params?.tripId ?? 'Not available';
  const rawDate = trip?.completedAt ?? trip?.createdAt ?? payment.booking?.confirmedAt;
  const actualDate = rawDate && Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toLocaleString('en-IN') : 'Not available';
  const category = trip?.vehicleType ?? ride?.vehicleType;
  const actualVehicle = category ? getVehicleDisplayName(category) : 'Not available';
  const method = payment.booking?.paymentMethod;
  const actualPaymentMethod = method === 'PAY_AT_PICKUP' ? 'Pay at pickup' : method === 'PAY_AT_DELIVERY' ? 'Pay at delivery' : 'Not available';
  const stops = [
    ...(trip?.pickup?.address || ride?.pickup?.address ? [{ label: 'Pickup', address: trip?.pickup?.address ?? ride?.pickup?.address ?? '' }] : []),
    ...(trip?.stops?.map(stop => ({ label: `Drop ${stop.sequence}`, address: stop.location.address ?? 'Not available' })) ?? ride?.drops?.map((drop, i) => ({ label: `Drop ${i + 1}`, address: drop.address ?? 'Not available' })) ?? []),
  ];
  const selectedParams = { trip, tripId: trip?.id, bookingId: trip?.paymentBookingId ?? ride?.paymentBookingId };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <BrandMark textStyle={styles.headerTitle} />
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('MainTabs', { screen: 'HelpScreen', params: { tripId: trip?.id, tripReference: trip?.externalRef ?? trip?.id ?? payment.booking?.externalRef } }))}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.successIconBox}>
            <MaterialIcons name={payment.booking?.paymentStatus === 'PAID' ? 'check-circle' : 'info'} size={32} color={colors.onSecondaryContainer} />
          </View>
          <Text style={styles.statusTitle}>{paymentLabel(payment.booking)}</Text>
          <Text style={styles.statusSubtitle}>Booking payment details</Text>
        </View>

        {/* Receipt Card */}
        <View style={styles.receiptCard}>
          {/* Decorative receipt edges could be SVGs, but we'll stick to RN borders/shadows */}
          
          {/* Trip Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>TRIP DETAILS</Text>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Trip ID</Text>
              <Text style={styles.monoValue}>{actualTripId}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Date & Time</Text>
              <Text style={styles.detailValue}>{actualDate}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Vehicle</Text>
              <Text style={styles.detailValue}>{actualVehicle}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Route Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ROUTE SUMMARY</Text>
            
            <View style={styles.routeContainer}>
              <View style={styles.timelineLine} />
              
              {stops.map((s, idx) => {
                const isFirst = idx === 0;
                const isLast = idx === stops.length - 1;
                return (
                  <View key={`route-${idx}`} style={styles.routeItem}>
                    {isFirst ? (
                      <View style={styles.pickupDotOuter}>
                        <View style={styles.pickupDotInner} />
                      </View>
                    ) : isLast ? (
                      <View style={styles.dropFinalDot} />
                    ) : (
                      <View style={styles.dropIntermediateDot} />
                    )}
                    <View style={styles.routeTextContainer}>
                      <Text style={styles.routeLabel}>{s.label}</Text>
                      <Text style={styles.routeValue}>{s.address}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>

          <View style={styles.divider} />

          {/* Fare Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>FARE SUMMARY</Text>
            <Text style={styles.detailLabel}>Detailed fare breakdown is not available.</Text>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>{actualTotal}</Text>
            </View>
          </View>

          <View style={styles.divider} />

          {/* Payment Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>PAYMENT DETAILS</Text>
            <View style={styles.paymentMethodCard}>
              <View style={styles.paymentMethodLeft}>
                <MaterialIcons name="account-balance" size={24} color={colors.onSurfaceVariant} />
                <View style={styles.paymentMethodTexts}>
                  <Text style={styles.paymentMethodName}>{actualPaymentMethod}</Text>
                  <Text style={styles.paymentMethodStatus}>Status: {paymentLabel(payment.booking)}</Text>
                </View>
              </View>
              <Feather name={payment.booking?.paymentStatus === 'PAID' ? 'check' : 'info'} size={20} color={colors.onSurfaceVariant} />
            </View>
          </View>

        </View>

        <BookingPaymentStatus state={payment} />

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            label={onShareReceipt ? 'SHARE RECEIPT' : 'Receipt sharing unavailable'}
            disabled={!onShareReceipt}
            onPress={() =>
              onShareReceipt
                ? onShareReceipt()
                : navigation?.navigate('ShareTrackingSheetScreen')
            }
            variant="primary"
            fullWidth
            size="lg"
            icon={<Feather name="share" size={20} color={colors.onPrimary} />}
          />
          <Button
            label="BACK TO HOME"
            onPress={() => {
              if (onHome) {
                onHome();
              } else {
                const root = navigation?.getParent?.() ?? navigation;
                root?.dispatch(
                  CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }],
                  })
                );
              }
            }}
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
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  successIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statusTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  receiptCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    marginBottom: spacing.xxl,
    ...shadows.card,
  },
  section: {
    marginBottom: spacing.xs,
  },
  sectionTitle: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  detailLabel: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  detailValue: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  monoValue: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant + '4D', // 30% opacity
    marginVertical: spacing.lg,
  },
  routeContainer: {
    paddingLeft: 24,
    position: 'relative',
  },
  timelineLine: {
    position: 'absolute',
    left: 4.5, // Center line with dots
    top: 10,
    bottom: 24,
    width: 2,
    backgroundColor: colors.outlineVariant + '80', // 50% opacity
  },
  routeItem: {
    position: 'relative',
    marginBottom: spacing.lg,
  },
  pickupDotOuter: {
    position: 'absolute',
    left: -26.5,
    top: 4,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surfaceContainerLow,
    zIndex: 10,
  },
  pickupDotInner: {
    // Empty inner
  },
  dropIntermediateDot: {
    position: 'absolute',
    left: -22.5,
    top: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.outline,
    zIndex: 10,
  },
  dropFinalDot: {
    position: 'absolute',
    left: -24.5,
    top: 6,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    zIndex: 10,
  },
  routeTextContainer: {
    paddingLeft: spacing.sm,
  },
  routeLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 2,
  },
  routeValue: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: colors.outlineVariant,
  },
  totalLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  totalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primary,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  paymentMethodCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  paymentMethodLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  paymentMethodTexts: {
    flexDirection: 'column',
  },
  paymentMethodName: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  paymentMethodStatus: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  actionsContainer: {
    gap: spacing.md,
  },
});

export default DigitalReceiptScreen;
