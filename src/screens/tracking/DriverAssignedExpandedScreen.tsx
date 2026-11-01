import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Image, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { useBooking } from '../../state/BookingContext';
import { useTripStatus } from '../../hooks/useTripStatus';
import { useAssignedDriverLocation } from '../../hooks/useAssignedDriverLocation';
import { getRideTrip } from '../../api/engine';
import { getVehicleImage } from '../../utils/vehicleAssets';
import { getVehicleCategoryDisplayName } from '../../utils/vehicleMapIcons';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoadRoute } from '../../hooks/useRoute';

export interface DriverAssignedExpandedScreenProps {
  readonly onBack?: () => void;
  readonly onTrackDriver?: () => void;
  readonly onCallDriver?: () => void;
  readonly onChatDriver?: () => void;
  readonly onCancelBooking?: () => void;
}
export default function DriverAssignedExpandedScreen({ onBack, onTrackDriver, onCallDriver, onChatDriver, onCancelBooking, navigation }: DriverAssignedExpandedScreenProps & { navigation?: any; route?: any }) {
  const { trip, setTrip, ride, assignedDriver, setAssignedDriver, draft } = useBooking();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [locationsOpen, setLocationsOpen] = useState(false);
  const { trip: polled } = useTripStatus(trip?.id ?? ride?.tripId ?? undefined, { intervalMs: 3_000 });
  useEffect(() => { if (polled) setTrip(polled); }, [polled, setTrip]);
  useEffect(() => {
    if (trip || !ride?.id) return;
    const controller = new AbortController();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restore = async () => {
      try {
        const found = await getRideTrip(ride.id, controller.signal);
        if (active && found) { setTrip(found); return; }
      } catch { /* Keep the confirmed assignment while trip recovery retries. */ }
      if (active) timer = setTimeout(restore, 5_000);
    };
    void restore();
    return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
  }, [trip, ride?.id, setTrip]);
  const current = polled ?? trip;
  const status = current?.status ?? ride?.tripStatus;
  useEffect(() => {
    const next = status === 'DRIVER_ARRIVED' ? 'PickupOtpVerificationScreen'
      : ['PICKUP_VERIFIED', 'IN_TRANSIT', 'DROP_PROGRESS'].includes(status ?? '') ? 'CustomerLiveTrackingScreen'
      : status === 'DELIVERED' || status === 'COMPLETED' ? 'TripCompletedScreen'
      : status === 'CANCELLED' ? 'TripCancelledStatusScreen' : undefined;
    if (next) navigation?.replace?.(next);
  }, [status, navigation]);
  const driverId = current?.driverId ?? ride?.assignedDriverId ?? undefined;
  const location = useAssignedDriverLocation(current?.id ?? ride?.tripId ?? undefined, driverId, !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(status ?? ''));
  useEffect(() => { if (location.driver) setAssignedDriver(location.driver); }, [location.driver, setAssignedDriver]);
  const driver = location.driver ?? (assignedDriver?.id === driverId ? assignedDriver : undefined);
  const vehicleType = current?.vehicleType ?? ride?.vehicleType ?? driver?.vehicleType ?? draft.vehicleType;
  const vehicleName = vehicleType ? getVehicleCategoryDisplayName(vehicleType) : 'Assigned vehicle';
  const driverName = driver?.name || 'Assigned driver';
  const pickup = current?.pickup ?? ride?.pickup ?? draft.pickup;
  const drops = current?.stops.length ? current.stops.map(stop => stop.location)
    : ride?.drops?.length ? ride.drops : draft.drops.length ? draft.drops : current?.drop ? [current.drop] : [];
  const road = useRoadRoute(location.point, pickup);
  const markers = useMemo<readonly MapMarker[]>(() => [
    ...(pickup ? [{ id: 'pickup', kind: 'pickup' as const, coordinate: pickup, title: 'Pickup' }] : []),
    ...(location.point ? [{ id: `assigned-${driverId}`, kind: 'driver' as const, coordinate: location.point, title: 'Your driver', vehicleType, preview: true }] : []),
  ], [pickup, location.point?.latitude, location.point?.longitude, driverId, vehicleType]);
  const bookingId = current?.paymentBookingId ?? ride?.paymentBookingId;
  const chat = () => onChatDriver ? onChatDriver() : navigation?.navigate('ActiveTripChatScreen', { tripId: current?.id, bookingId, driverName, vehicleType });
  const call = () => onCallDriver ? onCallDriver() : navigation?.navigate('CallDriverScreen', { trip: current, tripId: current?.id, bookingId });
  const track = () => onTrackDriver ? onTrackDriver() : navigation?.navigate('CustomerLiveTrackingScreen');
  const cancel = () => onCancelBooking ? onCancelBooking() : navigation?.navigate('CancellationReasonScreen');
  const live = location.status === 'live';
  const locationText = live ? 'Heading to your pickup location'
    : location.status === 'loading' || location.status === 'idle' ? 'Updating driver location...'
    : location.status === 'auth_error' ? 'Unable to access driver location. Tap to retry.' : 'Driver location temporarily unavailable. Tap to retry.';
  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" style={styles.iconButton} onPress={() => onBack ? onBack() : navigation?.goBack()}><Feather name="arrow-left" size={spacing.xl} color={colors.primary} /></Pressable>
      <Text style={styles.headerTitle}>Trip details</Text>
    </View>
    <MapCanvas style={{ height: Math.max(180, Math.min(330, height * 0.38)) }} appearance="home" recenterOnLayout markers={markers} fitToMarkers={markers.length > 0} fitRouteOnly={false}
      contentInsets={{ top: spacing.xxxl, bottom: spacing.xxxl }} polyline={road.polyline} routeStatus={road.status} onRetryRoute={road.retry} />
    <ScrollView style={styles.sheet} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.handle} />
      <Pressable style={styles.statusRow} onPress={location.refresh} accessibilityRole="button" accessibilityLabel="Refresh assigned driver location">
        <View style={styles.clock}><Feather name="clock" size={spacing.xl} color={colors.statusGreen} /></View>
        <View style={styles.flex}><Text style={styles.statusTitle}>Driver on the way</Text><Text style={styles.secondary}>{locationText}</Text></View>
      </Pressable>
      <View style={styles.card}>
        <View style={styles.driverRow}>
          <View style={styles.avatar}><Image source={getVehicleImage(vehicleType)} style={styles.vehicleImage} resizeMode="contain" /></View>
          <View style={styles.flex}><Text style={styles.name} numberOfLines={1}>{driverName}</Text><Text style={styles.secondary}>{vehicleName}</Text></View>
          <Text style={styles.assignedBadge}>Assigned</Text>
        </View>
        <View style={styles.actions}>
          <Pressable style={styles.trackButton} accessibilityRole="button" accessibilityLabel="Track driver" onPress={track}><Feather name="map-pin" size={spacing.lg} color={colors.onPrimary} /><Text style={styles.trackText}>Track driver</Text></Pressable>
          <Pressable style={styles.contactButton} accessibilityRole="button" accessibilityLabel="Call driver" onPress={call}><Feather name="phone" size={spacing.xl} color={colors.primary} /></Pressable>
          <Pressable style={styles.contactButton} accessibilityRole="button" accessibilityLabel="Chat with driver" onPress={chat}><Feather name="message-circle" size={spacing.xl} color={colors.primary} /></Pressable>
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.locationsHeading}><Text style={styles.name}>Locations</Text><Pressable accessibilityRole="button" accessibilityLabel="View all trip locations" onPress={() => setLocationsOpen(true)}><Text style={styles.viewAll}>View all</Text></Pressable></View>
        <View style={styles.addressRow}><View style={styles.pickupDot} /><View style={styles.flex}><Text style={styles.label}>PICKUP</Text><Text style={styles.address} numberOfLines={2}>{pickup?.address || 'Pickup address unavailable'}</Text></View></View>
        {drops[0] && <View style={styles.addressRow}><View style={styles.number}><Text style={styles.numberText}>1</Text></View><View style={styles.flex}><Text style={styles.label}>DROP {drops.length > 1 ? `1 OF ${drops.length}` : ''}</Text><Text style={styles.address} numberOfLines={2}>{drops[0].address || 'Drop address unavailable'}</Text></View></View>}
      </View>
      <Pressable style={styles.cancelButton} accessibilityRole="button" accessibilityLabel="Cancel booking" onPress={cancel}><Text style={styles.cancelText}>Cancel booking</Text></Pressable>
    </ScrollView>
    <Modal visible={locationsOpen} transparent animationType="slide" onRequestClose={() => setLocationsOpen(false)}>
      <View style={styles.modalRoot}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close locations" onPress={() => setLocationsOpen(false)} />
        <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} accessibilityViewIsModal>
          <View style={styles.locationsHeading}><Text style={styles.statusTitle}>All locations</Text><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close all locations" onPress={() => setLocationsOpen(false)}><Feather name="x" size={spacing.xl} color={colors.primary} /></Pressable></View>
          <ScrollView style={{ flexShrink: 1 }}><Text style={styles.label}>PICKUP</Text><Text style={styles.fullAddress}>{pickup?.address || 'Pickup address unavailable'}</Text>{drops.map((drop, index) => <View key={index}><Text style={styles.label}>DROP {index + 1}</Text><Text style={styles.fullAddress}>{drop.address || 'Drop address unavailable'}</Text></View>)}</ScrollView>
        </View>
      </View>
    </Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: spacing.rowHeightSm + spacing.xs, paddingHorizontal: spacing.sm, gap: spacing.sm },
  iconButton: { width: spacing.rowHeightSm + spacing.xs, height: spacing.rowHeightSm + spacing.xs, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...typography.headlineSm, color: colors.primary },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
  handle: { width: spacing.xxxl, height: spacing.xs, alignSelf: 'center', backgroundColor: colors.outlineVariant, borderRadius: borderRadius.full, marginTop: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  clock: { width: spacing.rowHeightSm, height: spacing.rowHeightSm, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successContainer },
  statusTitle: { ...typography.headlineSm, color: colors.primary },
  secondary: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: spacing.xs },
  card: { padding: spacing.md, borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.xl, gap: spacing.md },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: spacing.rowHeightStandard, height: spacing.rowHeightStandard, borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  vehicleImage: { width: spacing.rowHeightSm + spacing.xs, height: spacing.rowHeightSm + spacing.xs },
  name: { ...typography.bodyLg, fontWeight: '600', color: colors.primary },
  assignedBadge: { ...typography.labelSm, color: colors.statusGreen, backgroundColor: colors.successContainer, borderRadius: borderRadius.full, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  trackButton: { flex: 1, minHeight: spacing.rowHeightSm + spacing.xs, flexDirection: 'row', gap: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.full, backgroundColor: colors.primary },
  trackText: { ...typography.bodyMd, color: colors.onPrimary, fontWeight: '600' },
  contactButton: { width: spacing.rowHeightSm + spacing.xs, height: spacing.rowHeightSm + spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  locationsHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  viewAll: { ...typography.labelSm, fontWeight: '600', color: colors.primary, paddingVertical: spacing.sm },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  pickupDot: { width: spacing.sm, height: spacing.sm, backgroundColor: colors.statusGreen, borderRadius: borderRadius.full, marginTop: spacing.sm, marginHorizontal: spacing.xs },
  number: { width: spacing.lg, height: spacing.lg, borderRadius: borderRadius.full, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: spacing.xs },
  numberText: { ...typography.labelSm, color: colors.onPrimary },
  label: { ...typography.labelCaps, color: colors.onSurfaceVariant },
  address: { ...typography.bodyMd, color: colors.primary, marginTop: spacing.xs },
  cancelButton: { minHeight: spacing.rowHeightSm + spacing.xs, borderWidth: 1, borderColor: colors.errorContainer, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  cancelText: { ...typography.bodyMd, fontWeight: '600', color: colors.error },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.black + '66' },
  modalSheet: { maxHeight: '80%', padding: spacing.lg, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl, backgroundColor: colors.surface },
  fullAddress: { ...typography.bodyMd, color: colors.primary, marginTop: spacing.xs, marginBottom: spacing.lg },
});
