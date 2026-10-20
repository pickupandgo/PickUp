import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { useI18n } from '../../i18n';

export interface DropInfoCardProps {
  readonly address: string;
  readonly etaMinutes?: number;
  readonly distanceKm?: number;
  readonly status?: string;
  readonly onNavigatePress?: () => void;
  readonly navigateLabel?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const DropInfoCard: React.FC<DropInfoCardProps> = ({
  address,
  etaMinutes,
  distanceKm,
  status,
  onNavigatePress,
  navigateLabel,
  style,
  testID,
}) => {
  const { t } = useI18n();
  const resolvedNavigate = navigateLabel ?? t('trip.navigate');

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.header}>
        <View style={styles.pinContainer}>
          <Icon name="location_on" style={styles.pinIcon} />
        </View>
        <Text style={styles.address} numberOfLines={2}>{address}</Text>
      </View>
      {(etaMinutes !== undefined || distanceKm !== undefined || status) ? (
        <View style={styles.metrics}>
          {etaMinutes !== undefined ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{t('trip.eta')}</Text>
              <Text style={styles.metricValue}>{t('common.min', { count: etaMinutes })}</Text>
            </View>
          ) : null}
          {distanceKm !== undefined ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{t('trip.distance')}</Text>
              <Text style={styles.metricValue}>{t('common.km', { count: distanceKm })}</Text>
            </View>
          ) : null}
          {status ? (
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>{t('trip.statusLabel')}</Text>
              <Text style={styles.metricValue}>{status}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {onNavigatePress ? (
        <PrimaryButton label={resolvedNavigate} onPress={onNavigatePress} />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.containerPadding,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    gap: spacing.gutter,
    ...shadows.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.gutter,
  },
  pinContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinIcon: {
    fontSize: 18,
    color: colors.onPrimaryContainer,
  },
  address: {
    ...typography.bodyMd,
    color: colors.onSurface,
    flex: 1,
  },
  metrics: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
  metric: {
    alignItems: 'center',
    gap: spacing.unit,
  },
  metricLabel: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  metricValue: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onSurface,
  },
});

export default DropInfoCard;
