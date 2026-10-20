import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, spacing } from '../../theme';
import Icon from '../atoms/Icon';
import { useI18n } from '../../i18n';
import type { TripStop } from '../../types/trip';

export interface MultiStopTimelineProps {
  readonly stops: readonly TripStop[];
  readonly currentStopIndex: number;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const MultiStopTimeline: React.FC<MultiStopTimelineProps> = ({
  stops,
  currentStopIndex,
  style,
  testID,
}) => {
  const { t } = useI18n();

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="list">
      {stops.map((stop, index) => {
        const isCompleted = index < currentStopIndex || stop.status === 'completed';
        const isCurrent = index === currentStopIndex;
        const isFuture = index > currentStopIndex;
        const isLast = index === stops.length - 1;

        // Custom label mappings
        let displayLabel = stop.label;
        if (stop.type === 'pickup') displayLabel = t('trip.pickup');
        else if (stop.type === 'drop') displayLabel = t('trip.drop', { number: index });

        return (
          <View key={stop.id} style={styles.row}>
            <View style={styles.timelineColumn}>
              {isCompleted && (
                <View style={styles.iconContainerCompleted}>
                  <Icon name="check" style={styles.iconCompleted} />
                </View>
              )}
              {isCurrent && (
                <View style={styles.iconContainerCurrent}>
                  <Icon name="local_shipping" style={styles.iconCurrent} />
                </View>
              )}
              {isFuture && (
                <View style={styles.iconContainerFuture} />
              )}
              
              {!isLast && (
                <View style={[
                  styles.line, 
                  { backgroundColor: isCompleted ? colors.outlineVariant : colors.surfaceContainerHighest }
                ]} />
              )}
            </View>

            <View style={[styles.contentColumn, !isLast && { paddingBottom: spacing.lg }]}>
              {isCurrent ? (
                <>
                  <Text style={styles.currentLabel}>{t('trip.currentStop')}</Text>
                  <Text style={styles.currentTitle}>{displayLabel}</Text>
                  <Text style={styles.currentAddress} numberOfLines={1}>{stop.address}</Text>
                </>
              ) : (
                <>
                  <Text style={[styles.standardTitle, isFuture && { color: colors.onSurfaceVariant }]}>
                    {displayLabel}
                  </Text>
                  {isFuture && stop.address && (
                    <Text style={styles.futureAddress} numberOfLines={1}>{stop.address}</Text>
                  )}
                </>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: spacing.xs,
  },
  row: {
    flexDirection: 'row',
  },
  timelineColumn: {
    width: 32,
    alignItems: 'center',
  },
  contentColumn: {
    flex: 1,
    paddingLeft: spacing.md,
    justifyContent: 'flex-start',
    paddingTop: 2,
  },
  
  // Icons
  iconContainerCompleted: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  iconCompleted: {
    fontSize: 14,
    color: colors.outline,
  },
  
  iconContainerCurrent: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#d9dce1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCurrent: {
    fontSize: 18,
    color: '#000000',
  },
  
  iconContainerFuture: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surface,
  },
  
  line: {
    width: 1,
    flex: 1,
    marginVertical: 4,
  },
  
  // Text
  currentLabel: {
    ...typography.labelSm,
    color: colors.onSurface,
    fontWeight: '700',
  },
  currentTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    fontWeight: '600',
    marginTop: 2,
  },
  currentAddress: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
  standardTitle: {
    ...typography.bodyLg,
    color: colors.outline, // For completed
  },
  futureAddress: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
});

export default MultiStopTimeline;
