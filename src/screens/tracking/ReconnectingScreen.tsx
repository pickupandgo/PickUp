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

export interface ReconnectingScreenProps {
  readonly lastSignalTime?: string;
}

const ReconnectingScreen: React.FC<ReconnectingScreenProps & { navigation?: any }> = ({
  lastSignalTime = '14:02', // mock default
  navigation,
}) => {
  // Animations
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(1)).current;
  const slideValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Spin animation
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 3000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 0.5,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Slide animation for progress bar
    Animated.loop(
      Animated.sequence([
        Animated.timing(slideValue, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(slideValue, {
          toValue: 0,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    ).start();
  }, [spinValue, pulseValue, slideValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const slideWidth = slideValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['20%', '40%', '20%']
  });

  const slideTranslate = slideValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '400%'] // 400% of 20% width = moves to end
  });

  // Auto-navigate to NetworkErrorScreen after 3.0s for prototype
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation?.navigate('NetworkErrorScreen');
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Ambient background rings */}
        <View style={styles.ambientContainer} pointerEvents="none">
          <Animated.View style={[styles.ambientRing1, { transform: [{ rotate: spin }] }]} />
          <Animated.View style={[styles.ambientRing2, { transform: [{ rotate: spin }] }]} />
        </View>

        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Animated.View style={[styles.iconPulseRing, { opacity: pulseValue, transform: [{ scale: 1.1 }] }]} />
            <Animated.View style={{ transform: [{ rotate: spin }] }}>
              <Feather name="refresh-cw" size={36} color={colors.error} />
            </Animated.View>
          </View>

          <Text style={styles.title}>Connection Lost</Text>
          <Animated.Text style={[styles.subtitle, { opacity: pulseValue }]}>
            Reconnecting to Pick Up...
          </Animated.Text>

          {/* Indeterminate Progress Bar */}
          <View style={styles.progressTrack}>
            <Animated.View 
              style={[
                styles.progressIndicator, 
                { width: slideWidth, left: slideTranslate }
              ]} 
            />
          </View>

          <View style={styles.statusBadge}>
            <Feather name="wifi-off" size={14} color={colors.outline} />
            <Text style={styles.statusText}>Signal lost at {lastSignalTime}</Text>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    position: 'relative',
  },
  ambientContainer: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.1,
  },
  ambientRing1: {
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 1,
    borderColor: colors.outline,
    borderStyle: 'dashed',
    position: 'absolute',
  },
  ambientRing2: {
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 1,
    borderColor: colors.outline,
    borderStyle: 'dashed',
    position: 'absolute',
  },
  card: {
    width: '100%',
    maxWidth: 384,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    ...shadows.card,
    zIndex: 10,
  },
  iconContainer: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.errorContainer + '4D', // 30% opacity
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  iconPulseRing: {
    position: 'absolute',
    inset: 0,
    borderRadius: 48,
    backgroundColor: colors.errorContainer + '33', // 20% opacity
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    letterSpacing: typography.headlineMd.letterSpacing,
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.full,
    marginTop: 32,
    overflow: 'hidden',
    position: 'relative',
  },
  progressIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainer,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: borderRadius.full,
    marginTop: spacing.xl,
  },
  statusText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default ReconnectingScreen;
