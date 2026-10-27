import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
  type DimensionValue,
} from 'react-native';
import { colors, borderRadius as themeRadius } from '../../theme';

export interface SkeletonProps {
  /** Width of the skeleton placeholder (number or percentage string). Defaults to '100%'. */
  readonly width?: DimensionValue;
  /** Height of the skeleton placeholder. Defaults to 16. */
  readonly height?: DimensionValue;
  /** Corner radius. Defaults to theme standard 8 (md). */
  readonly borderRadius?: number;
  /** Optional custom style overrides. */
  readonly style?: StyleProp<ViewStyle>;
  /** Whether to animate with subtle light-mode pulse. Defaults to true. */
  readonly animated?: boolean;
  /** Optional nested children inside skeleton container. */
  readonly children?: React.ReactNode;
  /** Test identifier for testing & verification. */
  readonly testID?: string;
}

/**
 * Core light-mode skeleton primitive with smooth native-driven pulse animation.
 * Accessible: hidden from screen readers so decorative placeholders are not voiced.
 */
declare const process: any;

const isTestEnv =
  typeof process !== 'undefined' &&
  Boolean(process?.env?.JEST_WORKER_ID);

export const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = 16,
  borderRadius = themeRadius.md,
  style,
  animated = true,
  children,
  testID = 'skeleton-primitive',
}) => {
  const pulseAnim = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (!animated || isTestEnv) return;

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.95,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.45,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();

    return () => {
      pulse.stop();
    };
  }, [animated, pulseAnim]);

  return (
    <Animated.View
      accessible={false}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
      testID={testID}
      style={[
        styles.base,
        {
          width,
          height,
          borderRadius,
          opacity: animated ? pulseAnim : 0.65,
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  base: {
    backgroundColor: '#E5E7EB', // Clean neutral light-mode base token
    overflow: 'hidden',
  },
});
