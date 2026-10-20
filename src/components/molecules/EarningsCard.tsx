import React from 'react';
import { View, Text, StyleSheet, ViewStyle, Pressable } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';

import { useI18n } from '../../i18n';

export interface EarningsCardProps {
  readonly label: string;
  readonly amount: number;
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
  currency,
  tripCount,
  iconName = 'trending_up', // Used to match the arrow icon in screenshot
  onDetailsPress,
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
      <Text style={styles.amount}>
        {currency}{amount.toLocaleString('en-IN')}
      </Text>
      <View style={styles.footer}>
        {tripCount !== undefined ? (
          <Text style={styles.trips}>{t('wallet.tripsCount', { count: tripCount })}</Text>
        ) : <View />}
        {onDetailsPress ? (
          <Pressable
            onPress={onDetailsPress}
            style={styles.pillButton}
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
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  pillLabel: {
    ...typography.labelCaps,
    fontSize: 10,
    color: colors.onPrimaryContainer,
  },
});

export default EarningsCard;
