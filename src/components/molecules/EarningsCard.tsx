import React from 'react';
import { View, Text, StyleSheet, ViewStyle, ActivityIndicator } from 'react-native';
import { DashboardAction } from './DashboardAction';
import { formatRupees } from '../../services/payments/money';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

export interface EarningsCardProps {
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
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Icon name={iconName} style={styles.icon} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
      {loading ? <ActivityIndicator accessibilityLabel="Loading today’s earnings" /> :
        <Text style={styles.amount}>{amount === null ? '—' : formatRupees(amount, currency)}</Text>}
      {!loading && (error || amount === null) ? (
        <Text style={styles.trips} accessibilityLiveRegion="polite"
          accessibilityLabel={error ?? 'Earnings unavailable'}>Earnings unavailable</Text>
      ) : null}
      <View style={styles.footer}>
        {tripCount !== undefined ? (
          <Text style={styles.trips}>{tripCount} trips</Text>
        ) : <View />}
        {onDetailsPress ? (
          <DashboardAction label="DETAILS" onPress={onDetailsPress} style={styles.action} />
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
});

export default EarningsCard;
