import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import BottomNavBar from '../../components/BottomNavBar';
import { navigateToTab } from '../../navigation/tabRoutes';

const { width: screenWidth } = Dimensions.get('window');

const MapLoadingScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;
  const progressValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Shimmer/pulse for map skeleton
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 0.8,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.4,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();

    // Indeterminate progress bar
    Animated.loop(
      Animated.timing(progressValue, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, [pulseOpacity, progressValue]);

  const progressTranslate = progressValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['-100%', '100%'],
  });

  // Auto-navigate to ReconnectingScreen after 3.0s for prototype
  useEffect(() => {
    const timer = setTimeout(() => {
      navigation?.navigate('ReconnectingScreen');
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Top App Bar */}
      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.profileIconBox}>
              <Feather name="user" size={16} color={colors.onSurfaceVariant} />
            </View>
            <Text style={styles.headerTitle}>Pick Up</Text>
          </View>
          <View style={styles.iconButton}>
            <Feather name="bell" size={20} color={colors.onSurfaceVariant} />
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.mainContent}>
        {/* Skeleton Map Elements */}
        <Animated.View style={[styles.skeletonPill, { opacity: pulseOpacity }]} />
        
        <View style={styles.mapShapesContainer}>
          <Animated.View style={[styles.shape1, { opacity: pulseOpacity }]} />
          <Animated.View style={[styles.shape2, { opacity: pulseOpacity }]} />
          <Animated.View style={[styles.shape3, { opacity: pulseOpacity }]} />
          <Animated.View style={[styles.shape4, { opacity: pulseOpacity }]} />
        </View>

        {/* Loading Overlay */}
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingBox}>
            <Animated.View style={{ opacity: pulseOpacity }}>
              <Feather name="map-pin" size={32} color={colors.primary} />
            </Animated.View>
            
            <Text style={styles.loadingText}>Loading territory map...</Text>
            
            <View style={styles.progressTrack}>
              <Animated.View 
                style={[styles.progressIndicator, { left: progressTranslate }]} 
              />
            </View>
          </View>
        </View>

        {/* Bottom Sheet Skeleton */}
        <Animated.View style={[styles.bottomSheetSkeleton, { opacity: pulseOpacity }]} />
      </View>

      {/* Bottom Nav */}
      <BottomNavBar currentTab="home" onTabPress={(tabId) => navigateToTab(navigation, tabId)} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
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
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
  },
  profileIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
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
    padding: spacing.marginMobile,
  },
  skeletonPill: {
    width: '100%',
    maxWidth: 400,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainer,
    alignSelf: 'center',
    marginTop: spacing.md,
    zIndex: 10,
  },
  mapShapesContainer: {
    flex: 1,
    position: 'relative',
  },
  shape1: {
    position: 'absolute',
    top: '25%',
    left: '20%',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.surfaceContainer,
  },
  shape2: {
    position: 'absolute',
    top: '50%',
    right: '20%',
    width: 160,
    height: 80,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainerHigh,
    transform: [{ rotate: '12deg' }],
  },
  shape3: {
    position: 'absolute',
    bottom: '20%',
    left: '25%',
    width: 200,
    height: 60,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainer,
    transform: [{ rotate: '-6deg' }],
  },
  shape4: {
    position: 'absolute',
    top: 40,
    right: 40,
    width: 48,
    height: 48,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerHigh,
  },
  bottomSheetSkeleton: {
    height: 120,
    width: '100%',
    maxWidth: 600,
    alignSelf: 'center',
    backgroundColor: colors.surfaceContainer,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...shadows.card,
    position: 'absolute',
    bottom: 0,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.surface + '4D', // 30% opacity
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  loadingBox: {
    backgroundColor: colors.surfaceContainerLowest,
    paddingHorizontal: 32,
    paddingVertical: 24,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.card,
    width: 240,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: typography.dataMono.fontFamily || 'monospace', // fallback
    color: colors.onSurfaceVariant,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: borderRadius.full,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  progressIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
});

export default MapLoadingScreen;
