import { useChatNotifications } from '../../state/ChatNotifications';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Modal, BackHandler } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useFocusEffect } from '@react-navigation/native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { useBooking } from '../../state/BookingContext';
import { useAssignedDriverLocation } from '../../hooks/useAssignedDriverLocation';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useBookingPayment } from '../../hooks/useBookingPayment';
import { useRideOtps } from '../../hooks/useRideOtps';
import { getActiveTripForCustomer, getRide, getRideTrip } from '../../api/engine';
import { getFareQuote } from '../../api/payments';
import type { FareQuote } from '../../api/types';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoadRoute } from '../../hooks/useRoute';
import { getVehicleImage } from '../../utils/vehicleAssets';
import { getVehicleCategoryDisplayName } from '../../utils/vehicleMapIcons';
import { formatPaise, paymentLabel } from '../../utils/paymentPresentation';
import { savedCollectionPreference } from '../../state/collectionPreference';

export interface CustomerLiveTrackingScreenProps { readonly onBack?: () => void; readonly onCall?: () => void; readonly onChat?: () => void; }

/** One active-trip surface from driver assignment through delivery. */
export default function CustomerLiveTrackingScreen({ onBack, onCall, onChat, navigation }: CustomerLiveTrackingScreenProps & { navigation?: any }) {
  const { trip, setTrip, ride, setRide, assignedDriver, setAssignedDriver, customerId, draft } = useBooking();
  const { unread } = useChatNotifications();
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(true);
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false); }, []));
  const [collapsed, setCollapsed] = useState(false);
  const [sheet, setSheet] = useState<'fare' | 'locations'>();
  const [panelHeight, setPanelHeight] = useState(0);
  const [quote, setQuote] = useState<FareQuote>();
  const [quoteError, setQuoteError] = useState(false);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [restoreError, setRestoreError] = useState(false);
  // Acceptance can precede the trip read. Retry without dropping the assignment.
  useEffect(() => {
    if (trip || !focused || (!ride?.id && !customerId)) return;
    const controller = new AbortController(); let active = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const restore = async () => {
      try {
        const found = ride?.id ? await getRideTrip(ride.id, controller.signal) : await getActiveTripForCustomer(customerId!);
        if (!active) return;
        if (found) { setTrip(found); setRestoreError(false); return; }
        setRestoreError(true);
      } catch { if (active) setRestoreError(true); }
      if (active) timer = setTimeout(restore, 5000);
    };
    void restore();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [trip, ride?.id, customerId, focused, setTrip]);
  useEffect(() => {
    if (!trip?.rideId || ride?.id === trip.rideId) return;
    const controller = new AbortController();
    getRide(trip.rideId, controller.signal).then(value => { if (!controller.signal.aborted) setRide(value); }).catch(() => {});
    return () => controller.abort();
  }, [trip?.rideId, ride?.id, setRide]);
  const polling = useTripStatus(trip?.id ?? ride?.tripId ?? undefined, { enabled: focused });
  useEffect(() => { if (polling.trip) setTrip(polling.trip); }, [polling.trip, setTrip]);
  const current = polling.trip ?? trip;
  const status = current?.status ?? ride?.tripStatus;
  const terminal = status === 'COMPLETED' || status === 'CANCELLED';
  const pickupStage = status === 'DRIVER_ASSIGNED' || status === 'DRIVER_ARRIVED';
  const preTransit = pickupStage || status === 'PICKUP_VERIFIED';
  const dropStage = status === 'IN_TRANSIT' || status === 'DROP_PROGRESS';
  useEffect(() => {
    if (status === 'COMPLETED') navigation?.replace('TripCompletedScreen', { trip: current, tripId: current?.id });
    else if (status === 'CANCELLED') navigation?.replace('TripCancelledStatusScreen');
  }, [status, navigation, current?.id]);
  const driverId = current?.driverId ?? ride?.assignedDriverId ?? undefined;
  const location = useAssignedDriverLocation(current?.id ?? ride?.tripId ?? undefined, driverId, focused && !terminal && status !== 'DELIVERED');
  useEffect(() => { if (location.driver) setAssignedDriver(location.driver); }, [location.driver, setAssignedDriver]);
  const driver = location.driver ?? (assignedDriver?.id === driverId ? assignedDriver : undefined);
  const vehicle = current?.vehicleType ?? ride?.vehicleType ?? driver?.vehicleType ?? draft.vehicleType;
  const pickup = current?.pickup ?? ride?.pickup ?? draft.pickup;
  const drops = current?.stops.length ? current.stops.map(stop => stop.location) : ride?.drops?.length ? ride.drops : current?.drop ? [current.drop] : draft.drops;
  const remaining = current?.stops.filter(stop => !['DELIVERED', 'UNDELIVERED', 'CANCELLED'].includes(stop.status)) ?? [];
  const destination = preTransit ? pickup : remaining[remaining.length - 1]?.location ?? current?.drop ?? undefined;
  const road = useRoadRoute(location.point, destination, preTransit ? [] : remaining.slice(0, -1).map(stop => stop.location));
  const markers = useMemo<readonly MapMarker[]>(() => [
    ...(pickup ? [{ id: 'pickup', kind: 'pickup' as const, coordinate: pickup, title: 'Pickup' }] : []),
    ...(!preTransit ? drops.map((point, index) => ({ id: `drop-${index}`, kind: 'drop' as const, stopNumber: index + 1, coordinate: point, title: `Drop ${index + 1}` })) : []),
    ...(location.point ? [{ id: 'driver', kind: 'driver' as const, coordinate: location.point, vehicleType: vehicle, preview: true, bearing: location.driver?.bearingDegrees, title: 'Your driver' }] : []),
  ], [pickup, preTransit, drops, location.point, vehicle, location.driver?.bearingDegrees]);
  const otpState = useRideOtps(current?.rideId ?? ride?.id, { enabled: focused && !!status && !terminal && status !== 'DELIVERED' });
  const stopOtp = otpState.otps?.stops.find(stop => stop.sequence === current?.currentStop?.sequence);
  const otp = pickupStage ? otpState.otps?.pickup.otp : dropStage && !current?.currentStop?.otpVerified ? stopOtp?.otp : undefined;
  const withheld = pickupStage ? otpState.otps?.pickup.withheld : stopOtp?.withheld;
  const showOtp = pickupStage || (dropStage && !!current?.currentStop && !current.currentStop.otpVerified);
  const payment = useBookingPayment(current?.paymentBookingId ?? ride?.paymentBookingId);
  const method = payment.booking?.paymentMethod ?? current?.paymentMethod ?? ride?.paymentMethod;
  const collection = savedCollectionPreference(current?.metadata?.specialInstructions ?? ride?.metadata?.specialInstructions);
  const paymentTitle = method === 'PREPAID_UPI' ? 'UPI payment' : `${collection ?? 'Payment'}${method === 'PAY_AT_PICKUP' ? ' at pickup' : method === 'PAY_AT_DELIVERY' ? ' at drop' : ''}`;
  const total = payment.booking?.farePaise ?? current?.payablePaise ?? ride?.payablePaise ?? (current?.fare != null ? Math.round(current.fare * 100) : ride?.fare != null ? Math.round(ride.fare * 100) : undefined);
  const paymentText = payment.booking ? paymentLabel(payment.booking) : payment.loading ? 'Checking payment...' : 'Payment status unavailable';
  const quoteId = ride?.quoteId;
  // Read frozen prices on demand, including after restart. No local fee calculation.
  useEffect(() => {
    if (sheet !== 'fare' || !quoteId) return;
    const controller = new AbortController(); setQuote(undefined); setQuoteError(false);
    getFareQuote(quoteId, controller.signal).then(value => { if (!controller.signal.aborted && value.quoteId === quoteId) setQuote(value); }).catch(() => { if (!controller.signal.aborted) setQuoteError(true); });
    return () => controller.abort();
  }, [sheet, quoteId, quoteAttempt]);
  const breakdown = quote?.quoteId === quoteId && (total === undefined || quote?.payablePaise === total) ? quote : undefined;
  const headline = status === 'DRIVER_ASSIGNED' ? 'Driver on the way' : status === 'DRIVER_ARRIVED' ? 'Driver has arrived' : status === 'PICKUP_VERIFIED' ? 'Pickup confirmed' : dropStage ? 'On the way to the drop' : status === 'DELIVERED' ? 'Delivery finished' : 'Updating your trip';
  const subtitle = status === 'DRIVER_ASSIGNED' ? 'Heading to your pickup location' : status === 'DRIVER_ARRIVED' ? 'Your driver is at the pickup point' : status === 'PICKUP_VERIFIED' ? 'Your delivery will start shortly' : dropStage ? `Delivering to drop ${current?.currentStop?.sequence ?? 1}` : status === 'DELIVERED' ? 'Finalizing your trip' : restoreError ? 'Could not refresh trip. Retrying...' : 'Getting your trip details...';
  const contactParams = { trip: current, tripId: current?.id, bookingId: current?.paymentBookingId ?? ride?.paymentBookingId, driverName: driver?.name, vehicleType: vehicle };
  const backHome = useCallback(() => {
    if (onBack) return onBack();
    const root = navigation?.getParent?.();
    if (root?.dispatch) root.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }] }));
    else navigation?.navigate('MainTabs', { screen: 'HomeScreen' });
  }, [onBack, navigation]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { backHome(); return true; });
    return () => subscription.remove();
  }, [backHome]));
  const addressRows = (full = false) => <>
    <View style={styles.addressRow}><View style={styles.dotColumn}><View style={styles.pickupDot} /><View style={styles.connector} /></View><View style={styles.flex}><Text style={styles.pickupLabel}>PICKUP</Text><Text style={styles.address} numberOfLines={full ? undefined : 2}>{pickup?.address || 'Pickup address unavailable'}</Text></View></View>
    {(full ? drops : drops.slice(0, 1)).map((drop, index) => <View style={styles.addressRow} key={index}><View style={styles.dropDot}><Text style={styles.dropNumber}>{index + 1}</Text></View><View style={styles.flex}><Text style={styles.label}>DROP{drops.length > 1 ? ` ${index + 1} OF ${drops.length}` : ''}</Text><Text style={styles.address} numberOfLines={full ? undefined : 2}>{drop.address || 'Drop address unavailable'}</Text>{full && current?.stops[index] && <Text style={styles.caption}>{current.stops[index].status.replace(/_/g, ' ')}</Text>}</View></View>)}
  </>;
  return <View style={styles.page}>
    <MapCanvas style={StyleSheet.absoluteFillObject} appearance="home" markers={markers} fitToMarkers={markers.length > 0} fitRouteOnly={false} polyline={road.polyline} routeStatus={road.status} onRetryRoute={road.retry} contentInsets={{ top: insets.top + spacing.rowHeightStandard, bottom: panelHeight + spacing.lg }} />
    <SafeAreaView edges={['top']} style={styles.headerSafe} pointerEvents="box-none"><View style={styles.header} pointerEvents="box-none"><Pressable style={styles.backButton} accessibilityRole="button" accessibilityLabel="Back to Home" onPress={backHome}><Feather name="arrow-left" size={spacing.xl} color={colors.homeAction} /></Pressable><View style={styles.tripBadge}><View style={[styles.liveDot, { backgroundColor: location.status === 'live' ? colors.homePickup : colors.outline }]} /><Text style={styles.badgeText}>Your trip</Text></View></View></SafeAreaView>
    <View style={[styles.panel, { maxHeight: collapsed ? '24%' : '60%' }]} onLayout={event => setPanelHeight(event.nativeEvent.layout.height)}><SafeAreaView edges={['bottom']} style={styles.panelSafe}>
      <Pressable style={styles.handleButton} accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand trip details' : 'Expand map'} onPress={() => setCollapsed(value => !value)}><View style={styles.handle} /></Pressable>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Pressable style={styles.statusRow} onPress={location.refresh} accessibilityRole="button" accessibilityLabel="Refresh driver location"><View style={styles.clock}><Feather name="clock" size={spacing.xl} color={colors.homePickup} /></View><View style={styles.flex}><Text style={styles.headline}>{headline}</Text><Text style={styles.caption}>{subtitle}</Text></View>{location.status === 'live' && <View style={styles.liveRow}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>}</Pressable>
        {(polling.error || ['error', 'auth_error', 'stale', 'unavailable'].includes(location.status)) && <Text style={styles.caption}>Live location is temporarily unavailable. Retrying...</Text>}
        {!collapsed && <>
          <View style={[styles.card, styles.driverRow]}><View style={styles.avatar}><Image source={getVehicleImage(vehicle)} style={styles.vehicleImage} resizeMode="contain" /></View><View style={styles.flex}><Text style={styles.driverName} numberOfLines={1}>{driver?.name || 'Assigned driver'}</Text><Text style={styles.caption} numberOfLines={1}>{vehicle ? getVehicleCategoryDisplayName(vehicle) : 'Assigned vehicle'}</Text></View><Pressable style={styles.contact} accessibilityRole="button" accessibilityLabel="Call driver" onPress={() => onCall ? onCall() : navigation?.navigate('CallDriverScreen', contactParams)}><Feather name="phone" size={spacing.lg} color={colors.homeAction} /></Pressable><Pressable style={styles.contact} accessibilityRole="button" accessibilityLabel={unread ? "Chat with driver, unread message" : "Chat with driver"} onPress={() => onChat ? onChat() : navigation?.navigate('ActiveTripChatScreen', contactParams)}><Feather name="message-square" size={spacing.lg} color={colors.homeAction} />{unread && <View style={{ position: "absolute", top: spacing.xs, right: spacing.xs, width: spacing.sm, height: spacing.sm, borderRadius: borderRadius.full, backgroundColor: colors.homePickup }} />}</Pressable></View>
          {showOtp && <View style={styles.otpCard}><View style={styles.otpHeading}><Feather name="shield" size={spacing.xxl} color={colors.homePickup} /><View style={styles.flex}><Text style={styles.headline}>{pickupStage ? 'Pickup verification OTP' : 'Delivery verification OTP'}</Text><Text style={styles.caption}>{otp ? pickupStage ? 'Share only when your driver arrives' : 'Share at the drop to confirm receipt' : withheld === 'PAYMENT_REQUIRED' ? 'OTP will appear after the required payment is confirmed.' : otpState.error ? 'Unable to refresh OTP. Tap to retry.' : 'Waiting for handover authorization...'}</Text></View></View>{otp ? <View style={styles.digits}>{otp.split('').map((digit, index) => <View style={styles.digitBox} key={index}><Text style={styles.digit}>{digit}</Text></View>)}</View> : <Pressable accessibilityRole="button" accessibilityLabel="Refresh handover OTP" onPress={otpState.refresh}><Text style={styles.link}>Refresh OTP</Text></Pressable>}</View>}
          <View style={[styles.card, styles.routeCard]}><View style={styles.routeAddresses}>{addressRows()}</View><Pressable style={styles.viewAll} accessibilityRole="button" accessibilityLabel="View all trip locations" onPress={() => setSheet('locations')}><Text style={styles.link}>View all</Text><Feather name="chevron-right" size={spacing.lg} color={colors.homeAction} /></Pressable></View>
          <Pressable style={[styles.card, styles.paymentRow]} accessibilityRole="button" accessibilityLabel="View fare details" onPress={() => setSheet('fare')}><View style={styles.wallet}><Feather name="credit-card" size={spacing.xl} color={colors.homeAction} /></View><View style={styles.flex}><Text style={styles.headline}>{paymentTitle}</Text><Text style={styles.caption}>{paymentText}</Text></View><Text style={styles.headline}>{formatPaise(total)}</Text><Feather name="chevron-right" size={spacing.lg} color={colors.homeAction} /></Pressable>
          {pickupStage && <Pressable style={styles.cancel} accessibilityRole="button" accessibilityLabel="Cancel booking" onPress={() => navigation?.navigate('CancellationReasonScreen')}><Text style={styles.link}>Cancel booking</Text></Pressable>}
        </>}
      </ScrollView>
    </SafeAreaView></View>
    <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={() => setSheet(undefined)}><View style={styles.modalRoot}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close details" onPress={() => setSheet(undefined)} /><View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal>
      <View style={styles.handle} /><View style={styles.modalHeading}><Text style={styles.modalTitle}>{sheet === 'fare' ? 'Fare details' : 'All locations'}</Text><Pressable style={styles.contact} accessibilityRole="button" accessibilityLabel="Close details sheet" onPress={() => setSheet(undefined)}><Feather name="x" size={spacing.xxl} color={colors.homeAction} /></Pressable></View>
      <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>{sheet === 'locations' ? addressRows(true) : <>
        <View style={[styles.card, styles.paymentRow]}><View style={styles.wallet}><Feather name="credit-card" size={spacing.xl} color={colors.homeAction} /></View><View style={styles.flex}><Text style={styles.headline}>{paymentTitle}</Text><Text style={styles.caption}>Selected payment method</Text></View></View>
        {breakdown ? <>
          <View style={styles.spread}><Text style={styles.body}>Delivery fare</Text><Text style={styles.body}>{formatPaise(breakdown.deliveryFarePaise ?? breakdown.farePaise)}</Text></View>
          {breakdown.customerPlatformFeePaise !== undefined && <View style={styles.spread}><Text style={styles.body}>Platform fee{breakdown.customerPlatformFeeBps !== undefined ? ` (${breakdown.customerPlatformFeeBps / 100}%)` : ''}</Text><Text style={styles.body}>{formatPaise(breakdown.customerPlatformFeePaise)}</Text></View>}
          {(breakdown.surgeChargePaise ?? 0) > 0 && <View style={styles.spread}><Text style={styles.body}>Surge charge</Text><Text style={styles.body}>{formatPaise(breakdown.surgeChargePaise)}</Text></View>}
          {breakdown.taxPaise > 0 && <View style={styles.spread}><Text style={styles.body}>Tax</Text><Text style={styles.body}>{formatPaise(breakdown.taxPaise)}</Text></View>}
        </> : <Text style={styles.caption}>{quoteError || !quoteId || quote ? 'Fare breakdown is temporarily unavailable.' : 'Loading fare breakdown...'}</Text>}
        {(quoteError || (quote && !breakdown)) && <Pressable accessibilityRole="button" accessibilityLabel="Retry fare breakdown" onPress={() => setQuoteAttempt(value => value + 1)}><Text style={styles.link}>Retry breakdown</Text></Pressable>}
        <View style={[styles.spread, styles.total]}><Text style={styles.headline}>Total</Text><Text style={styles.headline}>{formatPaise(total ?? breakdown?.payablePaise)}</Text></View><Text style={styles.caption}>{paymentText}</Text>{payment.error && <Text style={styles.caption}>{payment.error}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh payment status" onPress={payment.refresh}><Text style={styles.link}>Refresh payment status</Text></Pressable>
        {payment.booking && payment.booking.stops.length > 1 && payment.booking.stops.map(stop => <View key={stop.sequence} style={styles.spread}><Text style={styles.caption}>Drop {stop.sequence} · {stop.state.replace(/_/g, ' ').toLowerCase()}</Text><Text style={styles.caption}>{formatPaise(stop.payablePaise)}</Text></View>)}
      </>}</ScrollView><Pressable style={styles.done} accessibilityRole="button" onPress={() => setSheet(undefined)}><Text style={styles.doneText}>Done</Text></Pressable>
    </View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface }, flex: { flex: 1, minWidth: 0 },
  headerSafe: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backButton: { width: spacing.rowHeightSm, height: spacing.rowHeightSm, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, ...shadows.sm },
  tripBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...shadows.sm },
  badgeText: { ...typography.labelSm, color: colors.homeAction, fontWeight: '700' },
  liveDot: { width: spacing.sm, height: spacing.sm, borderRadius: borderRadius.full, backgroundColor: colors.homePickup },
  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl, ...shadows.sm },
  panelSafe: { flexShrink: 1 }, handleButton: { height: spacing.xxl, alignItems: 'center', justifyContent: 'center' },
  handle: { width: spacing.xxxl, height: spacing.xs, backgroundColor: colors.outlineVariant, borderRadius: borderRadius.full, alignSelf: 'center' },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  clock: { width: spacing.rowHeightSm, height: spacing.rowHeightSm, borderRadius: borderRadius.full, backgroundColor: colors.successContainer, alignItems: 'center', justifyContent: 'center' },
  headline: { ...typography.bodyMd, color: colors.homeAction, fontWeight: '700' }, caption: { ...typography.labelSm, color: colors.secondary, marginTop: spacing.xs },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, liveText: { ...typography.labelSm, color: colors.homePickup, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.lg, padding: spacing.md },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: spacing.rowHeightSm + spacing.sm, height: spacing.rowHeightSm + spacing.sm, borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  vehicleImage: { width: spacing.rowHeightSm, height: spacing.rowHeightSm }, driverName: { ...typography.bodyLg, color: colors.homeAction, fontWeight: '700' },
  contact: { width: spacing.rowHeightSm, height: spacing.rowHeightSm, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.outlineHairline, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  otpCard: { backgroundColor: colors.selectionTint, borderRadius: borderRadius.lg, padding: spacing.md, gap: spacing.sm },
  otpHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing.md }, digits: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.xxxl + spacing.xs },
  digitBox: { width: spacing.rowHeightSm, height: spacing.rowHeightSm + spacing.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.md },
  digit: { ...typography.headlineMd, color: colors.homeAction, fontWeight: '700' }, routeCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, routeAddresses: { flex: 1, gap: spacing.md },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, dotColumn: { width: spacing.lg, alignItems: 'center', alignSelf: 'stretch', paddingTop: spacing.xs },
  pickupDot: { width: spacing.md, height: spacing.md, borderRadius: borderRadius.full, backgroundColor: colors.homePickup }, connector: { flex: 1, minHeight: spacing.md, borderLeftWidth: 1, borderColor: colors.outlineVariant, marginTop: spacing.xs },
  dropDot: { width: spacing.lg, height: spacing.lg, borderRadius: borderRadius.full, backgroundColor: colors.homeAction, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs }, dropNumber: { ...typography.labelSm, color: colors.onPrimary },
  pickupLabel: { ...typography.labelCaps, color: colors.homePickup }, label: { ...typography.labelCaps, color: colors.secondary }, address: { ...typography.bodyMd, color: colors.homeAction, marginTop: spacing.xs },
  viewAll: { flexDirection: 'row', alignItems: 'center', minHeight: spacing.rowHeightSm }, link: { ...typography.labelSm, color: colors.homeAction, fontWeight: '600' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, wallet: { width: spacing.xxxl, height: spacing.xxxl, borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  cancel: { minHeight: spacing.rowHeightSm, borderWidth: 1, borderColor: colors.homeAction, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' }, backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black, opacity: 0.4 },
  modalSheet: { maxHeight: '80%', backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl, padding: spacing.lg, gap: spacing.md },
  modalHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, modalTitle: { ...typography.headlineMd, color: colors.homeAction, fontWeight: '700' }, modalScroll: { flexShrink: 1 }, modalContent: { gap: spacing.md },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, body: { ...typography.bodyMd, color: colors.homeAction }, total: { borderTopWidth: 1, borderColor: colors.outlineHairline, paddingTop: spacing.md },
  done: { minHeight: spacing.rowHeightSm + spacing.sm, borderRadius: borderRadius.md, backgroundColor: colors.homeAction, alignItems: 'center', justifyContent: 'center' }, doneText: { ...typography.bodyMd, color: colors.onPrimary, fontWeight: '700' },
});
