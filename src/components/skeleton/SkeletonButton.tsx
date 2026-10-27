import React from 'react';
import type { StyleProp, ViewStyle, DimensionValue } from 'react-native';
import { Skeleton } from './Skeleton';
import { borderRadius } from '../../theme';

export interface SkeletonButtonProps {
  /** Width of the button skeleton. Defaults to '100%'. */
  readonly width?: DimensionValue;
  /** Height of the button skeleton. Defaults to 48. */
  readonly height?: number;
  /** Corner radius. Defaults to 12. */
  readonly borderRadius?: number;
  /** Custom style overrides. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Button skeleton placeholder matching primary/secondary action buttons.
 */
export const SkeletonButton: React.FC<SkeletonButtonProps> = ({
  width = '100%',
  height = 48,
  borderRadius: radius = borderRadius.md,
  style,
  testID = 'skeleton-button',
}) => {
  return (
    <Skeleton
      width={width}
      height={height}
      borderRadius={radius}
      style={style}
      testID={testID}
    />
  );
};
