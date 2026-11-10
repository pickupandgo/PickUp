import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTripEarning } from '../../hooks/useTripEarning';
import { fareText } from '../../services/payments/money';
import { colors, spacing, borderRadius, typography } from '../../theme';

const states = {
  AWAITING_SETTLEMENT: 'Awaiting settlement',
  PAYABLE: 'Payable',
  ON_HOLD: 'On hold',
  IN_PAYOUT: 'Payout in progress',
  PAID: 'Payout paid',
  SETTLED_IN_CASH: 'Settled in cash',
};
export function TripEarningCard({ tripId }: { tripId?: string | null }) {
  const { earning, loading, error, reload } = useTripEarning(tripId);
  const row = (label: string, amount: number) => (
    <View key={label} style={styles.row}>
      <Text style={styles.text}>{label}</Text>
      <Text style={styles.text}>{fareText(amount)}</Text>
    </View>
  );
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Driver earnings</Text>
      {loading ? (
        <Text style={styles.text}>Loading earnings…</Text>
      ) : error ? (
        <Pressable onPress={reload} accessibilityRole="button">
          <Text style={styles.error}>{error} Tap to retry.</Text>
        </Pressable>
      ) : !earning ? (
        <Text style={styles.text}>No earning record yet.</Text>
      ) : (
        <>
          <Text style={styles.status}>
            {states[earning.status]} ·{' '}
            {earning.settlement === 'MIXED'
              ? 'Cash + online'
              : earning.settlement === 'CASH'
              ? 'Cash'
              : 'Online'}
          </Text>
          {row('Customer amount collected', earning.grossAmountPaise)}
          {row('Platform fee deducted', earning.platformFeePaise)}
          {row('Other deductions', earning.otherDeductionsPaise)}
          {row('TDS', earning.tdsAmountPaise)}
          {row('Net driver earnings', earning.netAmountPaise)}
          {earning.netCashPaise !== undefined
            ? row('Net cash already kept', earning.netCashPaise)
            : null}
          {earning.payoutAmountPaise !== undefined
            ? row('Online payout portion', earning.payoutAmountPaise)
            : null}
          <Text style={styles.text}>
            Cash kept and bank payouts are separate.
          </Text>
        </>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  title: { ...typography.headlineSm, color: colors.onSurface },
  text: { ...typography.bodyMd, color: colors.onSurfaceVariant, flexShrink: 1 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.gutter,
  },
  status: { ...typography.labelSm, color: colors.primary },
  error: { ...typography.bodyMd, color: colors.error },
});
