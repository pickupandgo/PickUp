import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useI18n } from '../../i18n';
import type { TripStop } from '../../types/trip';

export interface JourneyRecapProps {
  readonly stops: readonly TripStop[];
  readonly title?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const JourneyRecap: React.FC<JourneyRecapProps> = ({
  stops,
  title,
  style,
  testID,
}) => {
  const { t } = useI18n();
  const displayTitle = title ?? t('trip.journeyRecap');

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <Text style={styles.title}>{displayTitle}</Text>
      <View style={styles.timeline}>
        {stops.map((stop, index) => {
          const displayLabel = stop.type === 'pickup'
            ? t('trip.pickup')
            : stop.type === 'drop'
              ? t('trip.drop', { number: index })
              : stop.label;
          return (
            <View key={stop.id} style={styles.stopRow}>
              <View style={styles.timelineColumn}>
                <View style={styles.completedDot}>
                  <Icon name="check" style={styles.checkIcon} />
                </View>
                {index < stops.length - 1 ? (
                  <View style={styles.line} />
                ) : null}
              </View>
              <View style={styles.stopContent}>
                <Text style={styles.stopLabel}>{displayLabel}</Text>
                <Text style={styles.stopAddress} numberOfLines={1}>{stop.address}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.containerPadding,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    gap: spacing.gutter,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  timeline: {
    gap: 0,
  },
  stopRow: {
    flexDirection: 'row',
    gap: spacing.gutter,
  },
  timelineColumn: {
    alignItems: 'center',
    width: 20,
  },
  completedDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#2e7d32',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIcon: {
    fontSize: 10,
    color: colors.onPrimary,
  },
  line: {
    width: 2,
    height: 24,
    backgroundColor: '#2e7d32',
  },
  stopContent: {
    flex: 1,
    paddingBottom: spacing.gutter,
    gap: 2,
  },
  stopLabel: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  stopAddress: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
});

export default JourneyRecap;
