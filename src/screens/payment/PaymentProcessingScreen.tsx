import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface PaymentProcessingScreenProps {
  readonly amount?: string;
}

const PaymentProcessingScreen: React.FC<PaymentProcessingScreenProps & { navigation?: any }> = ({
  amount = '₹ 340.00', // Use mock default
  navigation,
}) => {
  const rotation = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Spinner rotation
    Animated.loop(
      Animated.timing(rotation, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1000,
          easing: Easing.bezier(0.215, 0.61, 0.355, 1),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1000,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [rotation, pulse]);

  const spin = rotation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1.5],
  });

  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0],
  });

  // Auto-navigate to PaymentPendingScreen after 3.0s for prototype
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation?.navigate('PaymentPendingScreen');
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Background Ambient Effect */}
        <View style={styles.ambientGlow} />

        <View style={styles.content}>
          {/* Amount Display */}
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>AMOUNT</Text>
            <Text style={styles.amountText}>{amount}</Text>
          </View>

          {/* Enhanced Loading Visualizer */}
          <View style={styles.visualizerContainer}>
            {/* Outer Pulse Rings */}
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />
            <Animated.View
              style={[
                styles.pulseRingDelayed,
                {
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                  // We simulate delay via a second animated value ideally, 
                  // but for simplicity we rely on one pulse for mock. 
                  // A real implementation might use multiple animated values.
                },
              ]}
            />

            {/* Core Spinner */}
            <Animated.View style={[styles.spinnerRing, { transform: [{ rotate: spin }] }]}>
              {/* Using a partial border to simulate SVG stroke-dasharray */}
              <View style={styles.spinnerArc} />
            </Animated.View>

            {/* Center Icon */}
            <View style={styles.centerIcon}>
              <Feather name="credit-card" size={24} color={colors.primary} />
            </View>
          </View>

          {/* Typography & Status */}
          <View style={styles.textContainer}>
            <Text style={styles.title}>Processing Payment...</Text>
            <Text style={styles.subtitle}>
              Please do not close the app or hit the back button.
            </Text>
          </View>

          {/* Progress Indicator Dots */}
          <View style={styles.dotsContainer}>
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ambientGlow: {
    position: 'absolute',
    width: 384, // 96 * 4
    height: 384,
    borderRadius: 192,
    backgroundColor: colors.primaryFixed,
    opacity: 0.2,
    // Note: React Native doesn't support 'blur' natively like CSS backdrop-filter,
    // so we rely on the soft opacity color to simulate ambient glow.
  },
  content: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    zIndex: 10,
    paddingHorizontal: spacing.xl,
  },
  
  // Amount Display
  amountCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    width: '100%',
    alignItems: 'center',
    marginBottom: 48,
    borderWidth: 1,
    borderColor: colors.surfaceVariant + '80', // 50% opacity
    ...shadows.sm,
  },
  amountLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelSm.letterSpacing,
    marginBottom: spacing.xs,
  },
  amountText: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    letterSpacing: -0.5,
  },

  // Visualizer
  visualizerContainer: {
    width: 128,
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 40,
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 64,
    borderWidth: 2,
    borderColor: colors.primary + '1A', // 10%
  },
  pulseRingDelayed: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 64,
    borderWidth: 2,
    borderColor: colors.primary + '33', // 20%
  },
  spinnerRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: 'transparent',
    borderTopColor: colors.primary,
    borderRightColor: colors.primary,
  },
  spinnerArc: {
    // Empty, styling handled by parent border
  },
  centerIcon: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Typography
  textContainer: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    maxWidth: 250,
    lineHeight: 22,
  },

  // Dots
  dotsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 32,
    opacity: 0.6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
});

export default PaymentProcessingScreen;
