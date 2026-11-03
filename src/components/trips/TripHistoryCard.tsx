import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from '../atoms/Icon';
import type { TripHistoryRecord } from '../../types/tripHistory';
import { historyDate, historyMoney, historyStatus } from '../../services/trip/tripHistoryPresentation';
import { historicalVehicle } from '../../services/trip/historicalVehicle';
import { HistoricalVehicleImage } from './HistoricalVehicleImage';
import { shortTripLocation } from '../../services/trip/shortTripLocation';
import { colors, spacing, typography } from '../../theme';

/** Compact row; full addresses and financial breakdown remain in Trip Details. */
export const TripHistoryCard = memo(function TripHistoryRow({ trip, onPress, financeLoading = false }: {
  trip: TripHistoryRecord; onPress: (id: string) => void; financeLoading?: boolean;
}) {
  const status = historyStatus(trip.status); const vehicle = historicalVehicle(trip);
  const pickup = shortTripLocation(trip.pickupAddress);
  const destination = shortTripLocation(trip.stops[trip.stops.length - 1]?.address);
  const routeSummary = `${pickup} → ${destination}`;
  const statusColor = trip.status === 'COMPLETED' ? colors.success : trip.status === 'CANCELLED' ? colors.error : colors.onSurfaceMuted;
  const unavailable = financeLoading && trip.status === 'COMPLETED' && trip.paymentTripId ? 'Loading earnings…' : 'Earnings unavailable';
  return <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={() => onPress(trip.id)}
    accessibilityRole="button" accessibilityLabel="View trip details" accessibilityHint={`${routeSummary}. ${historyDate(trip)}. ${status.label}. Opens full trip details.`}>
    <HistoricalVehicleImage trip={trip} />
    <View style={styles.content}>
      <Text style={styles.title}>{vehicle.title}</Text>
      <Text style={styles.secondary} numberOfLines={2} ellipsizeMode="tail">{routeSummary}{trip.stops.length > 1 ? ` · ${trip.stops.length} stops` : ''}</Text>
      <Text style={styles.secondary}>{historyDate(trip)}</Text>
      <View style={styles.footer}><Text style={trip.earning ? styles.amount : styles.secondary}>{trip.earning ? historyMoney(trip.earning.netAmountPaise) : unavailable}</Text>
        <Text style={[styles.status, { color: statusColor }]}>· {status.label}</Text></View>
    </View>
    <Icon name="chevron_right" size={20} color={colors.onSurfaceMuted} />
  </Pressable>;
});
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 108, gap: spacing.sm, paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.sm, backgroundColor: colors.surfaceContainerLowest, borderBottomWidth: 1, borderBottomColor: colors.outlineSubtle },
  pressed: { backgroundColor: colors.surfaceContainerLow },
  content: { flex: 1, minWidth: 0, gap: 2 }, title: { ...typography.headlineSm, color: colors.primary },
  secondary: { ...typography.bodyMd, fontSize: 13, lineHeight: 18, color: colors.onSurfaceMuted },
  footer: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.unit, alignItems: 'center' },
  amount: { ...typography.bodyMd, fontWeight: '600', color: colors.primary }, status: { ...typography.bodyMd },
});
