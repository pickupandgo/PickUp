import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';
import type { TripStop } from '../../types/trip';

export interface JourneyRecapProps {
  readonly stops: readonly TripStop[];
  readonly title?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const JourneyRecap: React.FC<JourneyRecapProps> = ({
  stops,
  title = 'Journey Recap',
  style,
  testID,
}) => {
  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <Text style={styles.title}>{title}</Text>
      <View style={styles.timeline}>
        {stops.map((stop, index) => (
          <View key={stop.id} style={styles.stopRow}>
            <View style={styles.timelineColumn}>
              <View style={[styles.completedDot, { backgroundColor: stop.engineStatus === 'DELIVERED' ||
                (stop.type === 'pickup' && stop.status === 'completed') ? colors.success : colors.surfaceContainerHighest }]}>
                <Icon name={stop.engineStatus === 'DELIVERED' || (stop.type === 'pickup' && stop.status === 'completed') ? 'check' : 'remove'} style={styles.checkIcon} />
              </View>
              {index < stops.length - 1 ? (
                <View style={styles.line} />
              ) : null}
            </View>
            <View style={styles.stopContent}>
              <Text style={styles.stopLabel}>{stop.label}</Text>
              <Text style={styles.stopAddress} numberOfLines={1}>{stop.address}</Text>
            </View>
          </View>
        ))}
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
    backgroundColor: colors.success,
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
    backgroundColor: colors.outlineVariant,
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
