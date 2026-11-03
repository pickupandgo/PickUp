import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '../../theme';
export function TripLoadingSkeleton({ details = false }: { details?: boolean }) {
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={details ? 'Loading trip details' : 'Loading trip history'} style={styles.root}>
    {[0, 1, 2].map(key => <View key={key} style={[styles.block, details && styles.detail]}>
      <View style={styles.circle} /><View style={styles.lines}><View style={styles.long} /><View style={styles.short} /><View style={styles.short} /></View>
    </View>)}
  </View>;
}
const styles = StyleSheet.create({
  root: { width: '100%', gap: spacing.sm }, block: { minHeight: 108, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.containerPadding, backgroundColor: colors.surfaceContainerLowest },
  detail: { minHeight: 132, borderRadius: 16 }, circle: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.surfaceContainerHigh },
  lines: { flex: 1, gap: spacing.sm }, long: { height: 14, width: '80%', borderRadius: 4, backgroundColor: colors.surfaceContainerHigh },
  short: { height: 10, width: '55%', borderRadius: 4, backgroundColor: colors.surfaceContainerLow },
});
