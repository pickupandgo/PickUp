import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBooking } from '../../state/BookingContext';
import { useTripStatus } from '../../hooks/useTripStatus';
import { colors, spacing, typography, borderRadius } from '../../theme';

/** Shared read-only projection: status, receivers and instructions always come from this engine trip. */
export default function TripRouteDetailsScreen({
  navigation,
  route,
}: {
  navigation?: any;
  route?: any;
}) {
  const { trip: active } = useBooking();
  const requestedId =
    typeof route?.params?.tripId === 'string'
      ? route.params.tripId
      : active?.id;
  const live = useTripStatus(requestedId);
  const denied =
    live.error?.status === 401 ||
    live.error?.status === 403 ||
    live.error?.status === 404;
  const current = denied
    ? undefined
    : (live.trip ?? (active?.id === requestedId ? active : undefined));
  const selectedStopId = route?.params?.stopId;
  const selected = selectedStopId
    ? current?.stops.find((stop) => stop.id === selectedStopId)
    : undefined;
  const stops = selectedStopId
    ? selected
      ? [selected]
      : []
    : (current?.stops ?? []);
  const paymentBookingId = current?.paymentBookingId;
  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation?.goBack()}
        >
          <Text style={styles.action}>Back</Text>
        </Pressable>
        <Text style={styles.title}>Trip route</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {live.error && (
          <View style={styles.card}>
            <Text style={styles.body}>
              Could not refresh this trip. Displayed details may be out of date.
            </Text>
            <Pressable accessibilityRole="button" onPress={live.refresh}>
              <Text style={styles.action}>Retry</Text>
            </Pressable>
          </View>
        )}
        {!current ? (
          <Text style={styles.body}>
            {live.isLoading
              ? 'Loading trip?'
              : 'Trip details unavailable. Open a trip from your trips list.'}
          </Text>
        ) : (
          <>
            <Text style={styles.title}>
              Status: {current.status.replace(/_/g, ' ')}
            </Text>
            <Text style={styles.body}>
              {
                current.stops.filter((stop) => stop.status === 'DELIVERED')
                  .length
              }{' '}
              of {current.stops.length} drops delivered
            </Text>
            <View style={styles.card}>
              <Text style={styles.label}>Pickup</Text>
              <Text style={styles.body}>
                {current.pickup.address || 'Address unavailable'}
              </Text>
            </View>
            {selectedStopId && !selected && (
              <Text style={styles.body}>
                This stop is not part of this trip.
              </Text>
            )}
            {stops.map((stop) => (
              <View key={stop.id} style={styles.card}>
                <Text style={styles.label}>
                  Drop {stop.sequence} ? {stop.status.replace(/_/g, ' ')}
                </Text>
                <Text style={styles.body}>
                  {stop.location.address || 'Address unavailable'}
                </Text>
                <Text style={styles.body}>
                  Receiver: {stop.receiver?.name || 'Not provided'}
                </Text>
                {stop.receiver?.phone && (
                  <Text style={styles.body}>{stop.receiver.phone}</Text>
                )}
                {stop.instructions && (
                  <Text style={styles.body}>
                    Instructions: {stop.instructions}
                  </Text>
                )}
                {stop.failureReason && (
                  <Text style={styles.body}>Reason: {stop.failureReason}</Text>
                )}
                {stop.deliveredAt && (
                  <Text style={styles.body}>
                    Delivered: {new Date(stop.deliveredAt).toLocaleString()}
                  </Text>
                )}
              </View>
            ))}
            {paymentBookingId && (
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  navigation?.navigate('BookingStack', {
                    screen: 'DigitalReceiptScreen',
                    params: { paymentBookingId },
                  })
                }
              >
                <Text style={styles.action}>View payment details</Text>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
  },
  content: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    gap: spacing.sm,
  },
  title: { ...typography.headlineSm, color: colors.onSurface },
  label: { ...typography.labelSm, color: colors.onSurface },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  action: {
    ...typography.labelSm,
    color: colors.primary,
    paddingVertical: spacing.sm,
  },
});
