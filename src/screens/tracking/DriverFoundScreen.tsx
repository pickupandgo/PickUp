import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Pressable,
  ImageBackground,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface DriverFoundScreenProps {
  readonly onCancel?: () => void;
}

const DriverFoundScreen: React.FC<DriverFoundScreenProps & { navigation?: any }> = ({
  onCancel,
  navigation,
}) => {
  const [pulseAnim] = useState(new Animated.Value(0));
  const [slideDownAnim] = useState(new Animated.Value(-100)); // for toast
  const [slideUpAnim] = useState(new Animated.Value(200)); // for bottom sheet
  const [spinAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.timing(pulseAnim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.bezier(0.215, 0.61, 0.355, 1),
        useNativeDriver: true,
      })
    ).start();

    // Spinner animation
    Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();

    // Entry animations
    Animated.parallel([
      Animated.timing(slideDownAnim, {
        toValue: 0,
        duration: 500,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
      Animated.timing(slideUpAnim, {
        toValue: 0,
        duration: 600,
        easing: Easing.bezier(0.16, 1, 0.3, 1),
        useNativeDriver: true,
      }),
    ]).start();
  }, [pulseAnim, spinAnim, slideDownAnim, slideUpAnim]);

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 2],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0],
  });

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Auto-navigate to DriverAssignedScreen after 3.0s for prototype
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation?.navigate('DriverAssignedScreen');
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Map Canvas */}
      <ImageBackground
        source={{
          uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCRyJWOKsY-us35wkUfj1u9xmtW8WeADcfnDr2SKfp7SirU_iZsNuLuIf7q9jz_HvPFlH8xBFF02XgRKuiB80nWx7jubAdsIXvyD_7h7NUjqjd-zTmqmCKhRkiZQ794igAbEFlpWPw69EYJy5suK7Fr5NMlsnkOdPybfxA8RHjfNQ1dR2-UqsYR10jyG-DHoZbgUevphbrwvC7w61w6Eko782nPjrl1CdVwaetvJMzCX3RrIdz7fwap',
        }}
        style={styles.mapCanvas}
        resizeMode="cover"
      />

      <SafeAreaView style={styles.overlayArea}>
        {/* Top Floating Toast */}
        <Animated.View
          style={[
            styles.toastContainer,
            { transform: [{ translateY: slideDownAnim }] },
          ]}
        >
          <View style={styles.toast}>
            <Feather name="check-circle" size={24} color={colors.primary} />
            <Text style={styles.toastText}>Driver Found!</Text>
          </View>
        </Animated.View>

        {/* Central Map Marker */}
        <View style={styles.markerWrapper}>
          <View style={styles.markerContainer}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />
            <View style={styles.markerCenter}>
              <Feather name="truck" size={24} color={colors.onPrimary} />
            </View>
          </View>
        </View>

        {/* Bottom Spacer */}
        <View style={styles.flexSpacer} />

        {/* Bottom Sheet Expansion */}
        <Animated.View
          style={[
            styles.bottomSheetWrapper,
            { transform: [{ translateY: slideUpAnim }] },
          ]}
        >
          <View style={styles.bottomSheet}>
            {/* Handle */}
            <View style={styles.dragHandle} />

            <View style={styles.sheetContent}>
              {/* Status Row */}
              <View style={styles.statusRow}>
                <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]} />
                <View style={styles.statusTextCol}>
                  <Text style={styles.statusTitle}>Assigning driver to your trip...</Text>
                  <Text style={styles.statusSubtitle}>Matching you with the best vehicle nearby.</Text>
                </View>
              </View>

              {/* Fake Progress Bar */}
              <View style={styles.progressBarTrack}>
                <View style={styles.progressBarFill} />
              </View>

              {/* Cancel Button */}
              <Pressable
                style={styles.cancelButton}
                onPress={() => (onCancel ? onCancel() : navigation?.navigate('CancellationReasonScreen'))}
                accessibilityRole="button"
              >
                <Text style={styles.cancelButtonText}>Cancel Request</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapCanvas: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  overlayArea: {
    flex: 1,
    zIndex: 10,
  },

  // Toast
  toastContainer: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.marginMobile,
    zIndex: 40,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerLowest + 'F2', // 95% opacity
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.card,
  },
  toastText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },

  // Central Marker
  markerWrapper: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 96, // offset slightly up
    pointerEvents: 'none',
  },
  markerContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 96, // 200% of marker
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.primary,
  },
  markerCenter: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    ...shadows.elevated,
  },

  flexSpacer: {
    flex: 1,
  },

  // Bottom Sheet
  bottomSheetWrapper: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.md,
    zIndex: 30,
  },
  bottomSheet: {
    backgroundColor: colors.surfaceContainerLowest + 'F2', // 95% opacity
    borderRadius: borderRadius.lg, // approx 12px
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.elevated,
  },
  dragHandle: {
    width: 48,
    height: 6,
    borderRadius: borderRadius.full,
    backgroundColor: colors.outlineVariant,
    alignSelf: 'center',
    marginTop: -8,
    marginBottom: spacing.sm,
  },
  sheetContent: {
    gap: spacing.xl,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  spinner: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.surfaceVariant,
    borderTopColor: colors.primary,
  },
  statusTextCol: {
    flex: 1,
  },
  statusTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },
  progressBarTrack: {
    width: '100%',
    height: 6,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressBarFill: {
    width: '33%',
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
  cancelButton: {
    width: '100%',
    paddingVertical: spacing.md,
    backgroundColor: colors.secondaryContainer,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  cancelButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default DriverFoundScreen;
