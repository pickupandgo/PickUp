import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { StatusBadge } from '../../components/atoms/StatusBadge';
import { TripFinancialDetails } from '../../components/trips/TripFinancialDetails';
import { TripLoadingSkeleton } from '../../components/trips/TripLoadingSkeleton';
import { useTripHistory } from '../../hooks/useTripHistory';
import { historyDate, historyStatus, historyTime, historyTimeline } from '../../services/trip/tripHistoryPresentation';
import { historicalVehicle } from '../../services/trip/historicalVehicle';
import { HistoricalVehicleImage } from '../../components/trips/HistoricalVehicleImage';
import { DeliveryPhotoGallery } from '../../components/trips/DeliveryPhotoGallery';
import { shortTripLocation } from '../../services/trip/shortTripLocation';
import type { TripsScreenProps } from '../../types/navigation';

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return <View style={styles.card}><View style={styles.heading}><Icon name={icon} size={20} color={colors.navigationIcon} /><Text style={styles.title}>{title}</Text></View>{children}</View>;
}
function RoutePoint({ title, address, status, at, timeLabel, last = false }: { title: string; address: string | null; status?: string; at?: string | null; timeLabel?: string; last?: boolean }) {
  return <View style={styles.point}>
    <View style={styles.axis}><View style={[styles.dot, status === 'DELIVERED' && styles.successDot]} />{!last ? <View style={styles.line} /> : null}</View>
    <View style={styles.pointContent}><View style={styles.heading}><Text style={styles.label}>{title}</Text>{status ? <Text style={styles.muted}>{status.replace(/_/g, ' ')}</Text> : null}</View>
      <Text style={styles.body}>{shortTripLocation(address)}</Text>{at ? <Text style={styles.muted}>{timeLabel} · {historyTime(at)}</Text> : null}
    </View>
  </View>;
}
/** Existing HistoricalTripDetail route remains the only detail route. */
export function TripDetailsScreen({ navigation, route, testID }: TripsScreenProps<'HistoricalTripDetail'> & { testID?: string }) {
  const state = useTripHistory(route.params.tripId);
  const trip = state.items.find(item => item.id === route.params.tripId);
  const vehicle = trip ? historicalVehicle(trip) : null;
  const retry = () => { state.refresh().catch(() => {}); };
  const events = trip ? historyTimeline(trip) : [];
  const started = trip?.timeline.find(point => point.label === 'Trip started')?.at;
  const pickupAt = trip?.timeline.find(point => point.label === 'Pickup verified')?.at ?? trip?.timeline.find(point => point.label === 'Arrived at pickup')?.at;
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']} testID={testID}>
    <AppHeader title="Trip Details" onBackPress={() => navigation.goBack()} showBackButton />
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={state.refreshing} onRefresh={retry} />}>
      {state.loading || (!state.ready && !state.error) ? <TripLoadingSkeleton details /> : null}
      {state.error ? <Section title="Trip unavailable" icon="info"><Text style={styles.body} accessibilityRole="alert">{state.error}</Text><Pressable accessibilityRole="button" style={styles.action} onPress={retry}><Text style={styles.link}>Retry</Text></Pressable></Section> : null}
      {trip ? <>
        <View style={styles.card}>
          <View style={styles.summaryHeader}><Text style={styles.title}>{historyDate(trip)}</Text><StatusBadge {...historyStatus(trip.status)} /></View>
          <Text style={styles.label}>{vehicle?.title}</Text>
          {started ? <Text style={styles.muted}>Started · {historyTime(started)}</Text> : null}
        </View>
        <Section title="Vehicle" icon={vehicle?.icon ?? 'local_shipping'}>
          <View style={styles.heading}><HistoricalVehicleImage trip={trip} /><View style={styles.flex}><Text style={styles.label}>{vehicle?.title}</Text><Text style={styles.muted}>{vehicle?.detailsNote}</Text></View></View>
        </Section>
        <Section title="Route and delivery" icon="route">
          <RoutePoint title="Pickup" address={trip.pickupAddress} at={pickupAt} timeLabel={trip.timeline.some(point => point.label === 'Pickup verified') ? 'Pickup verified' : 'Arrived'} last={!trip.stops.length} />
          {trip.stops.map((stop, index) => <RoutePoint key={stop.id} title={`Drop ${stop.sequence}`} address={stop.address} status={stop.status}
            at={stop.deliveredAt ?? stop.failedAt ?? stop.arrivedAt} timeLabel={stop.deliveredAt ? 'Delivered' : stop.failedAt ? 'Failed' : 'Arrived'} last={index === trip.stops.length - 1} />)}
          <View style={styles.metrics}><Text style={styles.muted}>{trip.stops.length} {trip.stops.length === 1 ? 'drop' : 'drops'}</Text>
            {trip.distanceKm !== null ? <Text style={styles.muted}>{trip.distanceKm} km</Text> : null}
            {trip.weightKg !== null ? <Text style={styles.muted}>{trip.weightKg} kg</Text> : null}</View>
        </Section>
        <Section title="Delivery Photos" icon="photo_library"><DeliveryPhotoGallery trip={trip} /></Section>
        {trip.status === 'CANCELLED' ? <Section title="Cancellation" icon="cancel"><Text style={styles.body}>{trip.cancellationReason ?? 'Cancellation reason unavailable'}</Text><Text style={styles.muted}>Cancellation charges unavailable</Text></Section> : null}
        <Section title="Earnings" icon="payments"><TripFinancialDetails earning={trip.earning} loading={state.financeLoading} />
          {state.financeError ? <><Text style={styles.body} accessibilityRole="alert">{state.financeError}</Text><Pressable accessibilityRole="button" style={styles.action} onPress={retry}><Text style={styles.link}>Retry earnings</Text></Pressable></> : null}
        </Section>
        <Section title="Trip timeline" icon="history">
          {events.map((point, index) => <View key={`${point.label}:${point.at}`} style={styles.point}>
            <View style={styles.axis}><View style={[styles.eventDot, /failed|cancelled/i.test(point.label) && styles.errorDot]}><Icon name={/failed|cancelled/i.test(point.label) ? 'close' : 'check'} size={12} color={colors.onPrimary} /></View>{index < events.length - 1 ? <View style={styles.line} /> : null}</View>
            <View style={styles.pointContent}><Text style={styles.label}>{point.label}</Text><Text style={styles.muted}>{historyTime(point.at)}</Text></View>
          </View>)}
          <Text style={styles.muted}>{events.length ? 'Only recorded events are shown.' : 'Recorded timeline information is unavailable.'}</Text>
        </Section>
      </> : null}
    </ScrollView>
  </SafeAreaView>;
}
// Compatibility export preserves existing imports without adding a second navigation route.
export const HistoricalTripDetailScreen = TripDetailsScreen;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, content: { padding: spacing.containerPadding, paddingBottom: spacing.xl, gap: spacing.containerPadding, width: '100%', maxWidth: 800, alignSelf: 'center' },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.outlineSubtle, padding: spacing.containerPadding, gap: spacing.sm },
  heading: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' }, summaryHeader: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, alignItems: 'flex-start', justifyContent: 'space-between' },
  title: { ...typography.headlineSm, color: colors.primary, flexShrink: 1 },
  flex: { flex: 1, minWidth: 0, gap: spacing.unit },
  label: { ...typography.bodyMd, fontWeight: '600', color: colors.primary }, body: { ...typography.bodyMd, color: colors.onSurface }, muted: { ...typography.bodyMd, color: colors.onSurfaceMuted },
  action: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, link: { ...typography.bodyMd, color: colors.startupBlue, fontWeight: '500' },
  point: { flexDirection: 'row', gap: spacing.sm }, axis: { width: 20, alignItems: 'center' }, dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.navigationIcon, marginTop: 5 },
  successDot: { backgroundColor: colors.success }, line: { flex: 1, width: 1, minHeight: 20, backgroundColor: colors.outlineSubtle, marginVertical: spacing.unit },
  pointContent: { flex: 1, minWidth: 0, gap: spacing.unit, paddingBottom: spacing.containerPadding }, metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.containerPadding, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.outlineSubtle },
  eventDot: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.navigationIcon, alignItems: 'center', justifyContent: 'center' }, errorDot: { backgroundColor: colors.error },
});
export default TripDetailsScreen;

export { DriverHistoryDetail } from './EngineTripHistoryDetail';
