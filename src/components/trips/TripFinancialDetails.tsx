import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EarningDto } from '../../services/payments/earningsDto';
import { historyEarningLabel, historyMoney, settlementMethod } from '../../services/trip/tripHistoryPresentation';
import { colors, spacing, typography } from '../../theme';

export function TripFinancialDetails({ earning, loading = false }: { earning: EarningDto | null; loading?: boolean }) {
  if (!earning) return <Text style={styles.label}>{loading ? 'Loading earnings…' : 'Earnings unavailable'}</Text>;
  const rows = [ ['Gross earning', earning.grossAmountPaise], ['Platform fee', earning.platformFeePaise],
    ['Other deductions', earning.otherDeductionsPaise], ['TDS', earning.tdsAmountPaise] ] as const;
  return <View style={styles.root}>
    {rows.map(([label, amount]) => <View key={label} style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{historyMoney(amount)}</Text></View>)}
    <View style={styles.net}><Text style={styles.netLabel}>Net partner earnings</Text><Text style={styles.netAmount}>{historyMoney(earning.netAmountPaise)}</Text></View>
    <View style={styles.row}><Text style={styles.label}>Settlement method</Text><Text style={styles.value}>{settlementMethod(earning)}</Text></View>
    <Text style={styles.label}>{historyEarningLabel(earning)}</Text>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: spacing.sm }, row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  label: { ...typography.bodyMd, color: colors.onSurfaceMuted, flexShrink: 1 }, value: { ...typography.bodyMd, color: colors.onSurface, fontWeight: '600' },
  net: { borderTopWidth: 1, borderTopColor: colors.outlineSubtle, paddingVertical: spacing.sm, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'space-between', alignItems: 'center' },
  netLabel: { ...typography.headlineSm, color: colors.primary }, netAmount: { ...typography.headlineLg, color: colors.primary },
});
