import React from 'react';
import { View, Text, StyleSheet, ViewStyle, ActivityIndicator } from 'react-native';
import { DashboardAction } from './DashboardAction';
import { formatRupees } from '../../services/payments/money';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export interface EarningsCardProps {
  readonly compact?: boolean;
  readonly label: string;
  readonly amount: number | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly currency: string;
  readonly tripCount?: number;
  readonly iconName?: string;
  readonly onDetailsPress?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const EarningsCard: React.FC<EarningsCardProps> = ({
  compact = false,
  label,
  amount,
  loading = false,
  error = null,
  currency,
  tripCount,
  iconName = 'trending_up', // Used to match the arrow icon in screenshot
  onDetailsPress,
  style,
  testID,
}) => {
  return (
    <View style={[styles.container, compact && styles.compact, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        {!compact && <View style={styles.iconContainer}>
          <Icon name={iconName} style={styles.icon} />
        </View>}
        <Text style={[styles.label, compact && styles.compactLabel]}>{label}</Text>
      </View>
      {loading ? <ActivityIndicator accessibilityLabel="Loading today’s earnings" /> :
        <Text style={[styles.amount, compact && styles.compactAmount]}>{amount === null ? '—' : formatRupees(amount, currency)}</Text>}
      {!loading && (error || amount === null) ? (
        <Text style={[styles.trips, compact && styles.compactCaption]} accessibilityLiveRegion="polite"
          accessibilityLabel={error ?? 'Earnings unavailable'}>{compact ? 'Currently unavailable' : 'Earnings unavailable'}</Text>
      ) : null}
      <View style={[styles.footer, compact && styles.compactFooter]}>
        {tripCount !== undefined ? (
          <Text style={styles.trips}>{tripCount} trips</Text>
        ) : <View />}
        {onDetailsPress ? (
          <DashboardAction label={compact ? 'Details →' : 'DETAILS'} variant={compact ? 'link' : 'button'} onPress={onDetailsPress} style={styles.action} />
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.sm,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    gap: spacing.unit,
    flex: 1,
    minWidth: 0,
    minHeight: 164,
    ...shadows.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconContainer: {
    width: 24,
    height: 24,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 16,
    color: colors.primary,
  },
  label: {
    flexShrink: 1,
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  amount: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 'auto',
  },
  trips: {
    flexShrink: 1,
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  action: { maxWidth: '100%' },
  compact: { minHeight: 110, borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 10, elevation: 0, shadowOpacity: 0, gap: 0, paddingBottom: 0 },
  compactLabel: { fontSize: 13, lineHeight: 18, letterSpacing: 0, fontWeight: '600', color: colors.primary },
  compactAmount: { fontSize: 20, lineHeight: 27, marginTop: 6, fontWeight: '600', color: colors.primary },
  compactCaption: { fontSize: 11, lineHeight: 15, color: colors.homeMuted },
  compactFooter: { flexDirection: 'column', alignItems: 'flex-start', gap: 0 },
});

export default EarningsCard;
