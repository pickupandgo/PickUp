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

const DigitalReceiptScreen: React.FC<DigitalReceiptScreenProps & { navigation?: any }> = ({
  tripId = '#TRP-8472-X',
  date = 'Oct 24, 2023 • 11:30 AM',
  vehicle = 'Tata Ace (RJ 19 XX 1234)',
  baseFare = '₹380.00',
  insurance = '₹25.00',
  surcharges = '₹45.00',
  totalAmount = '₹450.00',
  paymentMethod = 'UPI (Secure Gateway)',
  paymentStatus = 'Paid',
  onShareReceipt,
  onHome,
  onHelp,
  onBack,
  navigation,
}) => {
  const { ride, trip, draft, assignedDriver } = useBooking();
  // Display only, from the server's quote figure; the backend is authoritative for what was paid.
  const currentFare =
    trip?.fare ?? ride?.fare ?? (draft.quote ? draft.quote.payablePaise / 100 : undefined);

  const actualTotal = currentFare ? `₹${Math.round(currentFare)}` : (totalAmount || '₹349');
  const actualBase = currentFare ? `₹${(currentFare * 0.8).toFixed(2)}` : baseFare; // Simplified breakup
  const actualTaxes = currentFare ? `₹${(currentFare * 0.2).toFixed(2)}` : surcharges;

  const actualTripId =
    trip?.externalRef ||
    ride?.externalRef ||
    (trip?.id ? `#TRP-${trip.id.substring(0, 6).toUpperCase()}` : undefined) ||
    (ride?.id ? `#TRP-${ride.id.substring(0, 6).toUpperCase()}` : undefined) ||
    tripId;

  const actualDate = useMemo(() => {
    const rawTime = trip?.completedAt || trip?.updatedAt || (trip as any)?.deliveredAt;
    if (rawTime) {
      const d = new Date(rawTime);
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = months[d.getMonth()];
      const day = d.getDate();
      const year = d.getFullYear();
      let hours = d.getHours();
      const minutes = d.getMinutes().toString().padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${month} ${day}, ${year} • ${hours}:${minutes} ${ampm}`;
    }
    return date;
  }, [trip?.completedAt, trip?.updatedAt, date]);

  const rawVehicleType =
    assignedDriver?.vehicleType ||
    (trip as any)?.vehicleType ||
    ride?.vehicleType ||
    draft.vehicleType;
  const vehicleName = getVehicleDisplayName(rawVehicleType);
  const vehiclePlate =
    (assignedDriver as any)?.vehicleNumber ||
    (assignedDriver as any)?.vehicleRegistrationNumber ||
    (trip as any)?.vehicleNumber ||
    (ride as any)?.vehicleNumber ||
    'KA 01 AB 1234';
  const actualVehicle = `${vehicleName} (${vehiclePlate})`;

  const actualPaymentMethod = useMemo(() => {
    const method = trip?.paymentMethod || ride?.paymentMethod || draft.paymentMethod;
    if (method === 'PAY_AT_PICKUP') return 'Cash / UPI (Pay at Pickup)';
    if (method === 'PAY_AT_DELIVERY') return 'Cash / UPI (Pay at Delivery)';
    return paymentMethod;
  }, [trip?.paymentMethod, ride?.paymentMethod, draft.paymentMethod, paymentMethod]);

  const stops = useMemo<Array<{ label: string; address: string }>>(() => {
    if (trip?.pickup?.address || (trip?.stops && trip.stops.length > 0)) {
      const list: Array<{ label: string; address: string }> = [];
      const pickupAddr = trip.pickup?.address || draft.pickup?.address;
      if (pickupAddr) list.push({ label: 'Pickup', address: pickupAddr });
      if (trip.stops && trip.stops.length > 0) {
        trip.stops.forEach((s, i) => {
          const isSingle = trip.stops.length === 1;
          const isLast = i === trip.stops.length - 1;
          const label = isSingle ? 'Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
          list.push({ label, address: s.location?.address || `Drop Location ${i + 1}` });
        });
      } else if (trip.drop?.address) {
        list.push({ label: 'Drop', address: trip.drop.address });
      }
      if (list.length >= 2) return list;
    }

    const rideDrops = ride?.drops;
    if (ride?.pickup?.address || (rideDrops && rideDrops.length > 0)) {
      const list: Array<{ label: string; address: string }> = [];
      const pickupAddr = ride.pickup?.address || draft.pickup?.address;
      if (pickupAddr) list.push({ label: 'Pickup', address: pickupAddr });
      if (rideDrops && rideDrops.length > 0) {
        rideDrops.forEach((d, i) => {
          const isSingle = rideDrops.length === 1;
          const isLast = i === rideDrops.length - 1;
          const label = isSingle ? 'Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
          list.push({ label, address: d.address || `Drop Location ${i + 1}` });
        });
      } else if (ride.drop?.address) {
        list.push({ label: 'Drop', address: ride.drop.address });
      }
      if (list.length >= 2) return list;
    }

    if (draft.pickup?.address && draft.drops && draft.drops.length > 0) {
      const list: Array<{ label: string; address: string }> = [
        { label: 'Pickup', address: draft.pickup.address },
      ];
      draft.drops.forEach((d, i) => {
        const isSingle = draft.drops.length === 1;
        const isLast = i === draft.drops.length - 1;
        const label = isSingle ? 'Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
        list.push({ label, address: d.address });
      });
      return list;
    }

    return [
      { label: 'Pickup', address: '42 MG Road, Bangalore' },
      { label: 'Drop 1', address: 'HSR Layout, Bangalore' },
      { label: 'Final Drop', address: 'Koramangala, Bangalore' },
    ];
  }, [trip, ride, draft]);

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
        <Text style={styles.headerTitle}>Precision Mobility</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.successIconBox}>
            <MaterialIcons name="check-circle" size={32} color={colors.onSecondaryContainer} />
          </View>
          <Text style={styles.statusTitle}>Payment Successful</Text>
          <Text style={styles.statusSubtitle}>Trip Receipt</Text>
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
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Base Fare</Text>
              <Text style={styles.monoValue}>{actualBase}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.detailLabel}>Taxes & Fees</Text>
              <Text style={styles.monoValue}>{actualTaxes}</Text>
            </View>
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
                  <Text style={styles.paymentMethodStatus}>Status: {paymentStatus}</Text>
                </View>
              </View>
              <Feather name="check" size={20} color={colors.secondary} />
            </View>
          </View>

        </View>

        {/* Actions */}
        <View style={styles.actionsContainer}>
          <Button
            label="SHARE RECEIPT"
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
                navigation?.dispatch(
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
