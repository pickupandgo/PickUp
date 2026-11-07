import { APP_NAME } from '../../config/brand';
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image, Modal, BackHandler } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { useSelectedTrip } from '../../hooks/useSelectedTrip';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useBookingPayment } from '../../hooks/useBookingPayment';
import { formatPaise, paymentLabel } from '../../utils/paymentPresentation';
import { useBooking } from '../../state/BookingContext';
import { getVehicleImage, getVehicleDisplayName } from '../../utils/vehicleAssets';
import { vehicleLabelFor } from '../../data/mockData';
import { getRide } from '../../api/engine';
import { getFareQuote } from '../../api/payments';
import type { FareQuote, Ride } from '../../api/types';
import { savedCollectionPreference } from '../../state/collectionPreference';

export interface TripCompletedScreenProps { readonly onDone?: () => void; readonly navigation?: any; readonly route?: any; }

/** Read-only completion summary. Active-state retirement is owned by BookingProvider. */
export default function TripCompletedScreen({ onDone, navigation, route }: TripCompletedScreenProps) {
  const context = useBooking();
  const selected = useSelectedTrip(route?.params, context.trip ?? context.completedBooking?.trip);
  const live = useTripStatus(selected?.id, { enabled: !!selected && selected.status !== 'COMPLETED' && selected.status !== 'CANCELLED' });
  const trip = live.trip ?? selected;
  useEffect(() => { if (live.trip && context.trip?.id === live.trip.id) context.setTrip(live.trip); }, [live.trip, context.trip?.id, context.setTrip]);
  const snapshot = context.completedBooking?.trip.id === trip?.id ? context.completedBooking : undefined;
  const scoped = !!trip && context.trip?.id === trip.id;
  const retainedRide = snapshot?.ride ?? (scoped && context.ride?.id === trip?.rideId ? context.ride : undefined);
  const driver = snapshot?.driver ?? (scoped && context.assignedDriver?.id === trip?.driverId ? context.assignedDriver : undefined);
  const [loadedRide, setLoadedRide] = useState<Ride>();
  useEffect(() => {
    if (!trip?.rideId || retainedRide) return;
    const controller = new AbortController();
    getRide(trip.rideId, controller.signal).then(value => { if (!controller.signal.aborted && value.id === trip.rideId) setLoadedRide(value); }).catch(() => {});
    return () => controller.abort();
  }, [trip?.rideId, retainedRide]);
  const ride = retainedRide ?? (loadedRide?.id === trip?.rideId ? loadedRide : undefined);
  const payment = useBookingPayment(trip?.paymentBookingId ?? ride?.paymentBookingId);
  const total = payment.booking?.farePaise ?? trip?.payablePaise ?? ride?.payablePaise ?? (trip?.fare != null ? Math.round(trip.fare * 100) : undefined);
  const method = payment.booking?.paymentMethod ?? trip?.paymentMethod ?? ride?.paymentMethod;
  const collection = savedCollectionPreference(trip?.metadata?.specialInstructions ?? ride?.metadata?.specialInstructions);
  const paymentTitle = method === 'PREPAID_UPI' ? 'UPI payment' : `${collection ?? 'Payment'}${method === 'PAY_AT_PICKUP' ? ' at pickup' : method === 'PAY_AT_DELIVERY' ? ' at drop' : ''}`;
  const paid = payment.booking?.paymentStatus === 'PAID';
  const paymentText = payment.booking ? paymentLabel(payment.booking) : payment.loading ? 'Checking payment...' : 'Payment status unavailable';
  const completed = trip?.status === 'COMPLETED';
  const mixed = trip?.stops?.some(stop => ['UNDELIVERED', 'FAILED', 'CANCELLED'].includes(stop.status));
  const phase = completed ? mixed ? 'Trip completed' : 'Delivered successfully' : trip?.status === 'DELIVERED' ? 'Finalizing trip' : trip?.status === 'CANCELLED' ? 'Trip cancelled' : 'Trip status unavailable';
  const vehicle = trip?.vehicleType ?? ride?.vehicleType ?? driver?.vehicleType;
  const completedAt = trip?.completedAt && Number.isFinite(Date.parse(trip.completedAt)) ? new Date(trip.completedAt) : undefined;
  const stops = trip?.stops?.length ? trip.stops : trip?.drop ? [{ sequence: 1, status: undefined, location: trip.drop }] : [];
  const [fareOpen, setFareOpen] = useState(false);
  const [quote, setQuote] = useState<FareQuote>();
  const [quoteError, setQuoteError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!fareOpen || !ride?.quoteId) return;
    const controller = new AbortController(); setQuote(undefined); setQuoteError(false);
    getFareQuote(ride.quoteId, controller.signal).then(value => { if (!controller.signal.aborted && value.quoteId === ride.quoteId) setQuote(value); }).catch(() => { if (!controller.signal.aborted) setQuoteError(true); });
    return () => controller.abort();
  }, [fareOpen, ride?.quoteId, attempt]);
  const breakdown = quote?.quoteId === ride?.quoteId && (total === undefined || quote?.payablePaise === total) ? quote : undefined;
  const home = useCallback(() => {
    if (onDone) return onDone();
    const root = navigation?.getParent?.();
    if (root?.dispatch) root.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs' }] }));
    else navigation?.navigate('MainTabs', { screen: 'HomeScreen' });
  }, [onDone, navigation]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { home(); return true; });
    return () => subscription.remove();
  }, [home]));

  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.header}><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back to Home" onPress={home}><Feather name="arrow-left" size={spacing.xxl} color={colors.homeAction} /></Pressable><Text style={styles.headerTitle}>{completed ? 'Trip completed' : phase}</Text></View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}><View style={styles.halo}><View style={styles.success}><Feather name={completed && !mixed ? 'check' : 'info'} size={spacing.xxxl} color={colors.onPrimary} /></View></View><Text style={styles.heroTitle}>{phase}</Text><Text style={styles.subtitle}>{mixed ? 'Some delivery stops need attention.' : completed ? `Your trip is complete. Thank you for choosing ${APP_NAME}.` : 'Waiting for final trip confirmation.'}</Text></View>
      {trip && <View style={styles.card}><Text style={styles.cardTitle}>Trip summary</Text>
        <View style={styles.addressRow}><View style={styles.pickupDot} /><View style={styles.flex}><Text style={styles.label}>PICKUP</Text><Text style={styles.body}>{trip.pickup?.address || 'Address unavailable'}</Text></View></View>
        {stops.map((stop, index) => <View style={styles.addressRow} key={stop.sequence}><View style={styles.dropDot}><Text style={styles.dropNumber}>{index + 1}</Text></View><View style={styles.flex}><Text style={styles.label}>DROP{stops.length > 1 ? ` ${index + 1} OF ${stops.length}` : ''}</Text><Text style={styles.body}>{stop.location?.address || 'Address unavailable'}</Text>{stop.status && stop.status !== 'DELIVERED' && <Text style={styles.statusNote}>{stop.status.replace(/_/g, ' ').toLowerCase()}</Text>}</View></View>)}
        <View style={[styles.driverRow, styles.divider]}>{vehicle && <Image source={getVehicleImage(vehicle)} style={styles.vehicleImage} resizeMode="contain" />}<View style={styles.flex}><Text style={styles.strong}>{vehicle ? vehicleLabelFor(getVehicleDisplayName(vehicle)) : 'Vehicle unavailable'}</Text><Text style={styles.muted}>{driver?.name || 'Driver details unavailable'}</Text></View></View>
        <View style={[styles.metadata, styles.divider]}><View style={styles.flex}><Text style={styles.muted}>Distance</Text><Text style={styles.strong}>{typeof trip.totalDistanceKm === 'number' ? `${trip.totalDistanceKm.toFixed(1)} km` : 'Not available'}</Text></View><View style={[styles.flex, styles.timeColumn]}><Text style={styles.muted}>Completed at</Text><Text style={styles.strong}>{completedAt ? `${completedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}, ${completedAt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : 'Not available'}</Text></View></View>
      </View>}
      <View style={styles.card}><View style={styles.spread}><View style={styles.inline}><Feather name="credit-card" size={spacing.xxl} color={colors.homeAction} /><Text style={styles.cardTitle}>Final amount</Text></View><Text style={styles.amount}>{formatPaise(total)}</Text></View><View style={styles.spread}><Text style={styles.muted}>{paymentTitle}</Text><View style={[styles.paymentBadge, paid && styles.paidBadge]}><Text style={[styles.paymentText, paid && styles.paidText]}>{paymentText}</Text></View></View><Pressable style={[styles.breakdownButton, styles.divider]} accessibilityRole="button" accessibilityLabel="View fare breakdown" onPress={() => setFareOpen(true)}><Feather name="file-text" size={spacing.xl} color={colors.homeAction} /><Text style={[styles.body, styles.flex]}>View fare breakdown</Text><Feather name="chevron-right" size={spacing.xl} color={colors.secondary} /></Pressable></View>
      {live.error && <Text style={styles.muted}>Could not refresh the trip. Retrying...</Text>}
      {completed && <View style={styles.savedNote}><Feather name="clock" size={spacing.lg} color={colors.secondary} /><Text style={styles.muted}>Trip details are saved in your trips.</Text></View>}
    </ScrollView>
    <View style={styles.footer} testID="completion-fixed-footer"><Pressable style={styles.homeButton} accessibilityRole="button" accessibilityLabel="Return to Home" onPress={home}><Text style={styles.homeText}>Back to Home</Text><Feather name="arrow-right" size={spacing.xxl} color={colors.onPrimary} /></Pressable></View>
    <Modal visible={fareOpen} transparent animationType="slide" onRequestClose={() => setFareOpen(false)}><View style={styles.modalRoot}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close fare details" onPress={() => setFareOpen(false)} /><View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal><View style={styles.spread}><Text style={styles.cardTitle}>Fare details</Text><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close fare sheet" onPress={() => setFareOpen(false)}><Feather name="x" size={spacing.xxl} color={colors.homeAction} /></Pressable></View><ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
      <Text style={styles.strong}>{paymentTitle}</Text>
      {breakdown ? <><View style={styles.spread}><Text style={styles.body}>Delivery fare</Text><Text style={styles.body}>{formatPaise(breakdown.deliveryFarePaise ?? breakdown.farePaise)}</Text></View>{breakdown.customerPlatformFeePaise !== undefined && <View style={styles.spread}><Text style={styles.body}>Platform fee{breakdown.customerPlatformFeeBps !== undefined ? ` (${breakdown.customerPlatformFeeBps / 100}%)` : ''}</Text><Text style={styles.body}>{formatPaise(breakdown.customerPlatformFeePaise)}</Text></View>}{(breakdown.surgeChargePaise ?? 0) > 0 && <View style={styles.spread}><Text style={styles.body}>Surge charge</Text><Text style={styles.body}>{formatPaise(breakdown.surgeChargePaise)}</Text></View>}{breakdown.taxPaise > 0 && <View style={styles.spread}><Text style={styles.body}>Tax</Text><Text style={styles.body}>{formatPaise(breakdown.taxPaise)}</Text></View>}</> : <Text style={styles.muted}>{quoteError || !ride?.quoteId || quote ? 'Fare breakdown is temporarily unavailable.' : 'Loading fare breakdown...'}</Text>}
      {(quoteError || (quote && !breakdown)) && <Pressable accessibilityRole="button" accessibilityLabel="Retry fare breakdown" onPress={() => setAttempt(value => value + 1)}><Text style={styles.strong}>Retry</Text></Pressable>}
      <View style={[styles.spread, styles.divider]}><Text style={styles.strong}>Total</Text><Text style={styles.strong}>{formatPaise(total ?? breakdown?.payablePaise)}</Text></View><Text style={styles.muted}>{paymentText}</Text>{payment.error && <Text style={styles.muted}>{payment.error}</Text>}<Pressable accessibilityRole="button" accessibilityLabel="Refresh payment status" onPress={payment.refresh}><Text style={styles.strong}>Refresh payment status</Text></Pressable>
      {payment.booking && payment.booking.stops.length > 1 && payment.booking.stops.map(stop => <View key={stop.sequence} style={styles.spread}><Text style={styles.muted}>Drop {stop.sequence}: {stop.state.replace(/_/g, ' ').toLowerCase()}</Text><Text style={styles.muted}>{formatPaise(stop.payablePaise)}</Text></View>)}
    </ScrollView></View></View></Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface }, flex: { flex: 1, minWidth: 0 }, scroll: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.sm, minHeight: spacing.rowHeightStandard, gap: spacing.sm },
  iconButton: { width: spacing.rowHeightSm, height: spacing.rowHeightSm, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.headlineMd, color: colors.homeAction, fontWeight: '700' },
  content: { padding: spacing.lg, gap: spacing.lg }, hero: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  halo: { width: spacing.xxxl * 3, height: spacing.xxxl * 3, backgroundColor: colors.selectionTint, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  success: { width: spacing.xxxl * 2, height: spacing.xxxl * 2, backgroundColor: colors.homePickup, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...typography.headlineLg, color: colors.homeAction, textAlign: 'center' }, subtitle: { ...typography.bodyMd, color: colors.secondary, textAlign: 'center' },
  card: { borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.xl, padding: spacing.lg, gap: spacing.lg },
  cardTitle: { ...typography.headlineSm, color: colors.homeAction, fontWeight: '700' }, body: { ...typography.bodyMd, color: colors.homeAction }, strong: { ...typography.bodyMd, color: colors.homeAction, fontWeight: '600' }, muted: { ...typography.labelSm, color: colors.secondary },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, label: { ...typography.labelCaps, color: colors.secondary, marginBottom: spacing.xs },
  pickupDot: { width: spacing.md, height: spacing.md, borderRadius: borderRadius.full, backgroundColor: colors.homePickup, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  dropDot: { width: spacing.xl, height: spacing.xl, borderRadius: borderRadius.full, backgroundColor: colors.homeAction, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs }, dropNumber: { ...typography.labelSm, color: colors.onPrimary },
  statusNote: { ...typography.labelSm, color: colors.error, marginTop: spacing.xs }, driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  vehicleImage: { width: spacing.rowHeightStandard + spacing.sm, height: spacing.rowHeightStandard }, divider: { borderTopWidth: 1, borderColor: colors.outlineHairline, paddingTop: spacing.md },
  metadata: { flexDirection: 'row', gap: spacing.md }, timeColumn: { borderLeftWidth: 1, borderColor: colors.outlineHairline, paddingLeft: spacing.lg },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, amount: { ...typography.headlineMd, color: colors.homeAction, fontWeight: '700' },
  paymentBadge: { backgroundColor: colors.surfaceContainerLow, borderRadius: borderRadius.full, paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, flexShrink: 1 }, paidBadge: { backgroundColor: colors.successContainer }, paymentText: { ...typography.labelSm, color: colors.secondary }, paidText: { color: colors.homePickup },
  breakdownButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: spacing.rowHeightSm }, savedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1, borderColor: colors.outlineHairline }, homeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.lg, minHeight: spacing.rowHeightStandard, backgroundColor: colors.homeAction, borderRadius: borderRadius.lg }, homeText: { ...typography.bodyLg, color: colors.onPrimary, fontWeight: '600' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black, opacity: 0.4 }, sheet: { maxHeight: '80%', backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl, padding: spacing.lg, gap: spacing.md }, sheetScroll: { flexShrink: 1 }, sheetContent: { gap: spacing.lg },
});
