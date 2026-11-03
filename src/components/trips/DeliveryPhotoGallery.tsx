import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TripHistoryRecord } from '../../types/tripHistory';
import { shortTripLocation } from '../../services/trip/shortTripLocation';
import { historyTime } from '../../services/trip/tripHistoryPresentation';
import { colors, spacing, typography } from '../../theme';

/** The current engine stores only one URI per drop, with no authorized image/thumbnail grants.
 * Do not turn a local file path, arbitrary HTTPS URI or upload attempt into an evidence image.
 */
export function DeliveryPhotoGallery({ trip }: { trip: TripHistoryRecord }) {
  return <View style={styles.groups}>{trip.stops.map(stop => <View key={stop.id} style={styles.group}>
    <Text style={styles.title}>Drop {stop.sequence} — {shortTripLocation(stop.address)}</Text>
    {!stop.deliveryPhoto ? <Text style={styles.body}>No delivery photo recorded for this drop.</Text> : <>
      <Text style={styles.body}>{stop.deliveryPhoto.availability === 'DEVICE_ONLY'
        ? 'A photo reference was recorded on the delivery device. A secure image preview is unavailable.'
        : 'A photo reference was recorded. A secure image preview is unavailable.'}</Text>
      {stop.deliveryPhoto.submittedAt ? <Text style={styles.body}>Recorded · {historyTime(stop.deliveryPhoto.submittedAt)}</Text> : null}
    </>}
  </View>)}{!trip.stops.length ? <Text style={styles.body}>No delivery drops recorded.</Text> : null}</View>;
}
const styles = StyleSheet.create({ groups: { gap: spacing.sm }, group: { gap: spacing.unit, paddingVertical: spacing.xs }, title: { ...typography.bodyMd, fontWeight: '600', color: colors.primary }, body: { ...typography.bodyMd, color: colors.onSurfaceMuted } });
