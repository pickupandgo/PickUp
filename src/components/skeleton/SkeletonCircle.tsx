import React from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { Skeleton } from './Skeleton';

export interface SkeletonCircleProps {
  /** Diameter of the circle. Defaults to 40. */
  readonly size?: number;
  /** Custom style overrides. */
  readonly style?: StyleProp<ViewStyle>;
  /** Test identifier. */
  readonly testID?: string;
}

/**
 * Circular skeleton for avatars, rounded icon buttons, and badges.
 */
export const SkeletonCircle: React.FC<SkeletonCircleProps> = ({
  size = 40,
  style,
  testID = 'skeleton-circle',
}) => {
  return (
    <Skeleton
      width={size}
      height={size}
      borderRadius={size / 2}
      style={style}
      testID={testID}
    />
  );
};
