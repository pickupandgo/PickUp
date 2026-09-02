import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import BottomNavBar from '../../components/BottomNavBar';
import { navigateToTab } from '../../navigation/tabRoutes';

const LiveTrackingExceptionsScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const pulseValue = useRef(new Animated.Value(1)).current;
  const slideValue = useRef(new Animated.Value(0)).current;
  const spinValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 0.4,
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

    // Slide down toast
    Animated.timing(slideValue, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();

    // Spin loader
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  }, [pulseValue, slideValue, spinValue]);

  const slideTranslate = slideValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-100, 0],
  });

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Auto-navigate to MapLoadingScreen after 3.0s for prototype
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation?.navigate('MapLoadingScreen');
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Pressable
              style={styles.iconButton}
              onPress={() => navigation?.goBack()}
              accessibilityRole="button"
            >
              <Feather name="arrow-left" size={24} color={colors.primary} />
            </Pressable>
            <Text style={styles.headerTitle}>Pick Up</Text>
          </View>
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation?.navigate('ActiveTripChatScreen')}
            accessibilityRole="button"
          >
            <Feather name="help-circle" size={24} color={colors.primary} />
          </Pressable>
        </View>
      </SafeAreaView>

      <View style={styles.mainContent}>
        {/* Background Mockup (Map) */}
        <View style={styles.mapBackground} />

        {/* Global Toast: Network Disconnected */}
        <Animated.View style={[styles.toastContainer, { transform: [{ translateY: slideTranslate }] }]}>
          <View style={styles.toast}>
            <Feather name="wifi-off" size={20} color={colors.error} />
            <View style={styles.toastTextContainer}>
              <Text style={styles.toastTitle}>Network disconnected</Text>
              <Text style={styles.toastSubtitle}>Reconnecting...</Text>
            </View>
            <Animated.View style={[styles.spinner, { transform: [{ rotate: spin }] }]} />
          </View>
        </Animated.View>

        <ScrollView contentContainerStyle={styles.scrollContent} pointerEvents="box-none">
          {/* Map Marker & Tag: Updating Location */}
          <View style={styles.overlayCard}>
            <View style={styles.markerContainer}>
              <View style={styles.markerCircle}>
                <Feather name="truck" size={16} color={colors.onPrimaryContainer} />
              </View>
              <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseValue }], opacity: pulseValue }]} />
            </View>
            <View style={styles.overlayTextContainer}>
              <View style={styles.rowAlign}>
                <Text style={styles.overlayTitle}>Driver Approaching</Text>
                <View style={styles.liveBadge}>
                  <Animated.View style={[styles.liveDot, { opacity: pulseValue }]} />
                  <Text style={styles.liveBadgeText}>LIVE</Text>
                </View>
              </View>
              <Text style={styles.overlaySubtitle}>Location updating...</Text>
            </View>
          </View>

          {/* Map Marker & Tag: Stale Data */}
          <View style={styles.overlayCard}>
            <View style={styles.markerContainer}>
              <View style={[styles.markerCircle, { backgroundColor: colors.surfaceVariant }]}>
                <Feather name="truck" size={16} color={colors.onSurfaceVariant} />
              </View>
            </View>
            <View style={styles.overlayTextContainer}>
              <Text style={[styles.overlayTitle, { color: colors.onSurfaceVariant }]}>Last Known Location</Text>
              <View style={styles.rowAlignSub}>
                <Feather name="clock" size={12} color={colors.outline} />
                <Text style={styles.overlaySubtitleSmall}>Last seen at 14th St & Broadway • 2 mins ago</Text>
              </View>
            </View>
          </View>

          {/* Tag: GPS Weak */}
          <View style={styles.overlayCardFlex}>
            <View style={styles.rowAlign}>
              <View style={styles.errorIconCircle}>
                <MaterialIcons name="satellite" size={20} color={colors.error} />
              </View>
              <View>
                <Text style={styles.overlayTitle}>Poor GPS Signal</Text>
                <Text style={styles.overlaySubtitle}>Location accuracy reduced</Text>
              </View>
            </View>
          </View>

          {/* Overlay Card: Tracking Temporarily Unavailable */}
          <View style={styles.largeOverlayCard}>
            <View style={styles.largeIconCircle}>
              <MaterialIcons name="location-disabled" size={24} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.largeTextContainer}>
              <Text style={styles.largeTitle}>Live Tracking Unavailable</Text>
              <Text style={styles.largeSubtitle}>We've temporarily lost connection with the vehicle. The driver is still en route to your destination.</Text>
            </View>
            <Pressable
              style={styles.primaryButton}
              onPress={() => navigation?.navigate('CallDriverScreen')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Call Driver</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>

      <BottomNavBar currentTab="trips" onTabPress={(tabId) => navigateToTab(navigation, tabId)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  headerSafeArea: {
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainContent: {
    flex: 1,
    position: 'relative',
  },
  mapBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surfaceContainerLow,
  },
  
  toastContainer: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.marginMobile,
    right: spacing.marginMobile,
    zIndex: 50,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderRadius: borderRadius.md,
    ...shadows.card,
    gap: spacing.sm,
  },
  toastTextContainer: {
    flex: 1,
  },
  toastTitle: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onErrorContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  toastSubtitle: {
    fontSize: 10,
    color: colors.onErrorContainer,
    opacity: 0.8,
  },
  spinner: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.error,
    borderTopColor: 'transparent',
  },

  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: 80, // push down below toast
    gap: spacing.md,
    justifyContent: 'flex-end',
    flexGrow: 1,
    paddingBottom: spacing.xl,
  },
  
  overlayCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surface + 'E6', // 90% opacity
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D', // 30% opacity
    gap: spacing.md,
    ...shadows.card,
  },
  overlayCardFlex: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainerLow + 'F2', // 95% opacity
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.card,
  },
  markerContainer: {
    width: 32,
    height: 32,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
    zIndex: 10,
  },
  pulseRing: {
    position: 'absolute',
    inset: -4,
    borderRadius: 20,
    backgroundColor: colors.secondary,
    zIndex: 0,
  },
  overlayTextContainer: {
    flex: 1,
  },
  rowAlign: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowAlignSub: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  overlayTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  overlaySubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },
  overlaySubtitleSmall: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.outline,
    fontFamily: typography.bodyMd.fontFamily,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.secondaryContainer + '80', // 50% opacity
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.secondary,
  },
  liveBadgeText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  errorIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.errorContainer + '4D', // 30% opacity
    alignItems: 'center',
    justifyContent: 'center',
  },

  largeOverlayCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '33', // 20% opacity
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.card,
  },
  largeIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  largeTextContainer: {
    alignItems: 'center',
  },
  largeTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  largeSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  primaryButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onPrimaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default LiveTrackingExceptionsScreen;
