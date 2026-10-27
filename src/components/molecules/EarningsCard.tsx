import React from 'react';
import { View, Text, StyleSheet, ViewStyle, Pressable } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { Skeleton } from '../skeleton';

import { useI18n } from '../../i18n';

export interface EarningsCardProps {
  readonly label: string;
  readonly amount: number;
  readonly currency: string;
  readonly tripCount?: number;
  readonly iconName?: string;
  readonly onDetailsPress?: () => void;
  readonly isLoading?: boolean;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const EarningsCard: React.FC<EarningsCardProps> = ({
  label,
  amount,
  currency,
  tripCount,
  iconName = 'trending_up', // Used to match the arrow icon in screenshot
  onDetailsPress,
  isLoading = false,
  style,
  testID,
}) => {
  const { t } = useI18n();

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Icon name={iconName} style={styles.icon} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
      {isLoading ? (
        <View style={{ marginVertical: 6 }} testID="earnings-card-loading">
          <Skeleton width={80} height={22} borderRadius={4} />
        </View>
      ) : (
        <Text style={styles.amount}>
          {currency}{amount.toLocaleString('en-IN')}
        </Text>
      )}
      <View style={styles.footer}>
        {isLoading ? (
          <Skeleton width={44} height={12} borderRadius={4} />
        ) : tripCount !== undefined ? (
          <Text style={styles.trips}>{t('wallet.tripsCount', { count: tripCount })}</Text>
        ) : <View />}
        {onDetailsPress ? (
          <Pressable
            onPress={onDetailsPress}
            style={({ pressed }) => [styles.pillButton, pressed && styles.pillButtonPressed]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={t('home.details')}
          >
            <Text style={styles.pillLabel}>{t('home.details')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.containerPadding,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    gap: spacing.xs,
    flex: 1,
    ...shadows.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  iconContainer: {
    width: 28,
    height: 28,
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
  },
  trips: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  pillButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 64,
  },
  pillButtonPressed: {
    opacity: 0.8,
  },
  pillLabel: {
    ...typography.labelCaps,
    fontSize: 11,
    fontWeight: '700',
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
});

export default EarningsCard;
