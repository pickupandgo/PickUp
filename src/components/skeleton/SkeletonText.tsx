import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle, type DimensionValue } from 'react-native';
import { Skeleton } from './Skeleton';
import { spacing } from '../../theme';

export interface SkeletonTextProps {
  /** Number of text lines to display. Defaults to 1. */
  readonly lines?: number;
  /** Height of each text line. Defaults to 14. */
  readonly lineHeight?: number;
  /** Width of the last line (e.g. '60%', 120). Defaults to '70%'. */
  readonly lastLineWidth?: DimensionValue;
  /** Width of other lines. Defaults to '100%'. */
  readonly width?: DimensionValue;
  /** Spacing between consecutive lines. Defaults to 8. */
  readonly lineSpacing?: number;
  /** Corner radius for text ends. Defaults to 4. */
  readonly borderRadius?: number;
  /** Optional container style override. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Text line placeholder with natural paragraph-like ragged right ending.
 */
export const SkeletonText: React.FC<SkeletonTextProps> = ({
  lines = 1,
  lineHeight = 14,
  lastLineWidth = '70%',
  width = '100%',
  lineSpacing = 8,
  borderRadius = 4,
  style,
  testID = 'skeleton-text',
}) => {
  return (
    <View style={[styles.container, style]} testID={testID}>
      {Array.from({ length: lines }).map((_, index) => {
        const isLast = index === lines - 1;
        const currentWidth = isLast && lines > 1 ? lastLineWidth : width;
        return (
          <Skeleton
            key={index}
            width={currentWidth}
            height={lineHeight}
            borderRadius={borderRadius}
            style={index > 0 ? { marginTop: lineSpacing } : undefined}
          />
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
});
