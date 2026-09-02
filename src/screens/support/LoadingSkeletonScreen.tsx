import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { Animated, Easing } from 'react-native';

export interface LoadingSkeletonScreenProps {
  readonly onBack?: () => void;
  readonly onProfile?: () => void;
}

const LoadingSkeletonScreen: React.FC<LoadingSkeletonScreenProps & { navigation?: any }> = ({
  onBack,
  onProfile,
  navigation,
}) => {
  // Animation values for skeleton pulse
  const pulseOpacity = React.useRef(new Animated.Value(0.5)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseOpacity, {
          toValue: 0.5,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseOpacity]);

  const animatedSkeletonStyle = {
    opacity: pulseOpacity,
  };

  // Linear loader animation
  const linearProgress = React.useRef(new Animated.Value(-1)).current;

  React.useEffect(() => {
    Animated.loop(
      Animated.timing(linearProgress, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    ).start();
  }, [linearProgress]);

  const animatedLinearStyle = {
    left: linearProgress.interpolate({
      inputRange: [-1, 1],
      outputRange: ['-100%', '100%']
    }),
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
          >
            <Feather name="menu" size={24} color={colors.onSurfaceVariant} />
          </Pressable>
        </View>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable
          style={styles.profileButton}
          onPress={() => (onProfile ? onProfile() : navigation?.navigate('ProfileScreen'))}
        >
          <Feather name="user" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Loading States</Text>
          <Text style={styles.pageSubtitle}>Reference library for asynchronous operations.</Text>
        </View>

        {/* 1. Global Process Loading */}
        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <MaterialIcons name="loop" size={18} color={colors.primary} />
            <Text style={styles.cardTitle}>Global Process Loading</Text>
          </View>
          <Text style={styles.cardSubtitle}>Used for primary actions requiring network latency.</Text>
          
          <View style={styles.primaryLoadingButton}>
            <Text style={styles.primaryLoadingText}>Processing Request...</Text>
            <View style={styles.linearTrack}>
              <Animated.View style={[styles.linearIndicator, animatedLinearStyle]} />
            </View>
          </View>
        </View>

        <View style={styles.gridContainer}>
          {/* 2. Trip History Item Skeleton */}
          <View style={styles.smallCard}>
            <Text style={styles.sectionLabel}>TRIP HISTORY ITEM</Text>
            <Animated.View style={[styles.skeletonRow, animatedSkeletonStyle]}>
              <View style={styles.skeletonIconBox} />
              <View style={styles.skeletonColumnLeft}>
                <View style={[styles.skeletonLine, { width: '75%', height: 16 }]} />
                <View style={[styles.skeletonLine, { width: '50%', height: 12, backgroundColor: colors.surfaceContainerHigh }]} />
              </View>
              <View style={styles.skeletonColumnRight}>
                <View style={[styles.skeletonLine, { width: 64, height: 16 }]} />
                <View style={[styles.skeletonLine, { width: 48, height: 12, backgroundColor: colors.surfaceContainerHigh }]} />
              </View>
            </Animated.View>
          </View>

          {/* 2b. Address Search Result Skeleton */}
          <View style={styles.smallCard}>
            <Text style={styles.sectionLabel}>ADDRESS SEARCH</Text>
            <Animated.View style={[styles.skeletonList, animatedSkeletonStyle]}>
              <View style={styles.skeletonRowAlign}>
                <View style={styles.skeletonCircle} />
                <View style={styles.skeletonColumnLeft}>
                  <View style={[styles.skeletonLine, { width: '100%', height: 12 }]} />
                  <View style={[styles.skeletonLine, { width: '66%', height: 10, backgroundColor: colors.surfaceContainerHigh }]} />
                </View>
              </View>
              <View style={styles.skeletonRowAlign}>
                <View style={styles.skeletonCircle} />
                <View style={styles.skeletonColumnLeft}>
                  <View style={[styles.skeletonLine, { width: '90%', height: 12 }]} />
                  <View style={[styles.skeletonLine, { width: '75%', height: 10, backgroundColor: colors.surfaceContainerHigh }]} />
                </View>
              </View>
            </Animated.View>
          </View>

          {/* 2c. Fare Breakdown Skeleton */}
          <View style={styles.smallCard}>
            <Text style={styles.sectionLabel}>FARE BREAKDOWN</Text>
            <Animated.View style={[styles.skeletonList, animatedSkeletonStyle]}>
              <View style={styles.skeletonSpaceBetween}>
                <View style={[styles.skeletonLine, { width: '33%', height: 12, backgroundColor: colors.surfaceContainerHigh }]} />
                <View style={[styles.skeletonLine, { width: 64, height: 12 }]} />
              </View>
              <View style={styles.skeletonSpaceBetween}>
                <View style={[styles.skeletonLine, { width: '25%', height: 12, backgroundColor: colors.surfaceContainerHigh }]} />
                <View style={[styles.skeletonLine, { width: 48, height: 12 }]} />
              </View>
              <View style={styles.skeletonDivider} />
              <View style={[styles.skeletonSpaceBetween, { marginTop: 4 }]}>
                <View style={[styles.skeletonLine, { width: '33%', height: 16 }]} />
                <View style={[styles.skeletonLine, { width: 80, height: 16 }]} />
              </View>
            </Animated.View>
          </View>

          {/* 4b. Payment Processing Skeleton */}
          <View style={styles.smallCard}>
            <Text style={styles.sectionLabel}>PAYMENT ACTIVE</Text>
            <Animated.View style={[styles.paymentBox, animatedSkeletonStyle]}>
              <View style={styles.skeletonRowAlign}>
                <View style={styles.skeletonPaymentIcon} />
                <View style={[styles.skeletonLine, { width: 96, height: 12, backgroundColor: colors.surfaceContainerHigh }]} />
              </View>
              <View style={styles.spinner} />
            </Animated.View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
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
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    gap: spacing.lg,
  },
  pageHeader: {
    marginBottom: spacing.xs,
  },
  pageTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onBackground,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Generic Card
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    ...shadows.card,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onBackground,
    fontFamily: typography.headlineSm.fontFamily,
  },
  cardSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: spacing.md,
  },

  // Primary Loading Button
  primaryLoadingButton: {
    height: 56,
    backgroundColor: colors.primaryContainer,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  primaryLoadingText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
    zIndex: 10,
  },
  linearTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.secondaryContainer + '4D', // 30% opacity
  },
  linearIndicator: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '50%',
    backgroundColor: '#8683e6', // approximating secondary-fixed from a generic theme for visual indicator
  },

  // Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  smallCard: {
    flex: 1,
    minWidth: '100%', // Mobile first, single column usually, or adjust to 45% for multi-column if needed
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh,
    ...shadows.card,
    gap: spacing.sm,
  },
  sectionLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: spacing.xs,
  },

  // Skeletons
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonIconBox: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceVariant,
  },
  skeletonColumnLeft: {
    flex: 1,
    gap: spacing.xs,
  },
  skeletonColumnRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  skeletonLine: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.full,
  },
  
  skeletonList: {
    gap: spacing.md,
  },
  skeletonRowAlign: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  skeletonCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHighest,
  },
  
  skeletonSpaceBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skeletonDivider: {
    height: 1,
    backgroundColor: colors.surfaceVariant,
    width: '100%',
    marginVertical: 4,
  },

  paymentBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerLowest,
  },
  skeletonPaymentIcon: {
    width: 40,
    height: 24,
    borderRadius: 2,
    backgroundColor: colors.surfaceVariant,
  },
  spinner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.surfaceVariant,
    borderTopColor: colors.outlineVariant,
    // Note: CSS animate-spin isn't trivial without an image or animated rotate, leaving static placeholder
  },
});

export default LoadingSkeletonScreen;
