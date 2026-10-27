import React from 'react';
import type { StyleProp, ViewStyle, DimensionValue } from 'react-native';
import { Skeleton } from './Skeleton';
import { borderRadius } from '../../theme';

export interface SkeletonButtonProps {
  /** Width of the button placeholder. Defaults to '100%'. */
  readonly width?: DimensionValue;
  /** Height of the button placeholder. Defaults to 48. */
  readonly height?: DimensionValue;
  /** Corner radius. Defaults to theme full pill. */
  readonly radius?: number;
  /** Optional custom container style overrides. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Button skeleton placeholder matching primary CTA geometry.
 */
export const SkeletonButton: React.FC<SkeletonButtonProps> = ({
  width = '100%',
  height = 48,
  radius = borderRadius.full,
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
