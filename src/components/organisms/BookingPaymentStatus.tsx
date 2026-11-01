import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { useBookingPayment } from '../../hooks/useBookingPayment';
import { formatPaise, paymentLabel } from '../../utils/paymentPresentation';
import { colors, spacing, typography } from '../../theme';
export default function BookingPaymentStatus({ state }: { state: ReturnType<typeof useBookingPayment> }) {
  const booking = state.booking;
  return <View style={styles.box}>
    <Text style={styles.text}>{booking ? paymentLabel(booking) : state.loading ? 'Checking payment...' : 'Payment status unavailable'}</Text>
    {booking && <>
      <Text style={styles.text}>Booking fare: {formatPaise(booking.farePaise)}</Text>
      {booking.stops?.map(stop => <Text key={stop.sequence} style={styles.text}>Drop {stop.sequence}: {stop.state.replace(/_/g, ' ').toLowerCase()} - {formatPaise(stop.payablePaise)}</Text>)}
      {!!booking.paymentGate?.stage && <Text style={styles.text}>{booking.paymentGate.stage === 'PICKUP' ? 'Pickup' : `Drop ${booking.paymentGate.stopSequence}`} payment: {booking.paymentGate.paymentState.replace(/_/g, ' ').toLowerCase()}</Text>}
    </>}
    {state.error && <Text style={styles.text}>{state.error}</Text>}
    <Pressable accessibilityRole="button" onPress={state.refresh}><Text style={styles.link}>Refresh payment status</Text></Pressable>
  </View>;
}
const styles = StyleSheet.create({ box: { padding: spacing.md, backgroundColor: colors.surface }, text: { ...typography.bodyMd, color: colors.onSurface }, link: { ...typography.bodyMd, color: colors.primary, marginTop: spacing.sm } });
