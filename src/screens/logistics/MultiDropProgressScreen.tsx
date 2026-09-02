import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { mockActiveTrip } from '../../data/mockData';

export interface MultiDropProgressScreenProps {
  readonly onBack?: () => void;
  readonly onMore?: () => void;
}

const MultiDropProgressScreen: React.FC<MultiDropProgressScreenProps & { navigation?: any }> = ({
  onBack,
  onMore,
  navigation,
}) => {
  const stops = mockActiveTrip.stops;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Route</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onMore ? onMore() : navigation?.navigate('ShareTrackingSheetScreen'))}
          accessibilityRole="button"
        >
          <Feather name="more-vertical" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Live Status Banner */}
        <View style={styles.liveBanner}>
          <View style={styles.liveBannerLeft}>
            <View style={styles.liveDotContainer}>
              <View style={styles.liveDotRing} />
              <View style={styles.liveDotCore} />
            </View>
            <View>
              <Text style={styles.liveBannerTitle}>Trip Status: Live</Text>
              <Text style={styles.liveBannerSubtitle}>Last updated 30s ago</Text>
            </View>
          </View>
          <View style={styles.statusBadge}>
            <Text style={styles.statusBadgeText}>En Route</Text>
          </View>
        </View>

        {/* Vertical Timeline Journey */}
        <View style={styles.timelineContainer}>
          <View style={styles.timelineLine} />

          {stops.map((stop, index) => {
            const isCompleted = stop.status === 'completed';
            const isActive = stop.status === 'current';
            const isPending = stop.status === 'upcoming';
            
            // Note: Since stops[0] is pickup, drops start from index 1.
            let stopLabel = 'Drop';
            if (index === 0) stopLabel = 'Pickup';
            else if (index === stops.length - 1) stopLabel = 'Final Drop';
            else stopLabel = `Drop ${index} of ${stops.length - 1}`;

            if (isActive) {
              return (
                <Pressable
                  key={index}
                  style={[styles.timelineRow, styles.timelineRowActive]}
                  onPress={() => navigation?.navigate('CurrentDropDetailsScreen')}
                  accessibilityRole="button"
                >
                  {/* Highlight line overlay for active state */}
                  <View style={styles.timelineLineActive} />
                  
                  <View style={styles.nodeColumn}>
                    <View style={styles.activeNodeRing}>
                      <View style={styles.activeNodeCore} />
                    </View>
                  </View>
                  
                  <View style={styles.activeContent}>
                    <View style={styles.activeContentHeader}>
                      <Text style={styles.activeLabelCaps}>Current {stopLabel}</Text>
                      <View style={styles.etaBadge}>
                        <Text style={styles.etaBadgeText}>ETA: 12 mins</Text>
                      </View>
                    </View>
                    <Text style={styles.activeAddress}>{stop.address}</Text>
                    <View style={styles.transitStatusRow}>
                      <Feather name="navigation" size={14} color={colors.onSurfaceVariant} />
                      <Text style={styles.transitStatusText}>In Transit</Text>
                    </View>
                  </View>
                </Pressable>
              );
            }

            return (
              <Pressable
                key={index}
                style={[
                  styles.timelineRow,
                  isCompleted && styles.timelineRowCompleted,
                ]}
                onPress={() => navigation?.navigate('CurrentDropDetailsScreen')}
                accessibilityRole="button"
              >
                <View style={styles.nodeColumn}>
                  {isCompleted && (
                    <View style={styles.completedNode}>
                      <Feather name="check" size={16} color={colors.onSurfaceVariant} />
                    </View>
                  )}
                  {isPending && <View style={styles.pendingNode} />}
                </View>
                
                <View style={[styles.contentColumn, index < stops.length - 1 && styles.contentDivider]}>
                  <Text style={styles.standardLabel}>{stopLabel}</Text>
                  <Text style={[
                    styles.standardAddress,
                    isCompleted && styles.completedAddress,
                  ]}>
                    {stop.address}
                  </Text>
                  <Text style={styles.standardTime}>
                    {isCompleted ? 'Completed at 10:15 AM' : 'Pending'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
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
    zIndex: 40,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    letterSpacing: -0.5,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: 100, // padding for bottom nav
  },

  // Live Banner
  liveBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant,
  },
  liveBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveDotContainer: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  liveDotRing: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 6,
    backgroundColor: colors.primary,
    opacity: 0.3,
  },
  liveDotCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  liveBannerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  liveBannerSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  statusBadge: {
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
  },

  // Timeline
  timelineContainer: {
    position: 'relative',
    width: '100%',
    paddingVertical: spacing.sm,
  },
  timelineLine: {
    position: 'absolute',
    left: 23, // center of the 48px column width
    top: 24,
    bottom: 24,
    width: 2,
    backgroundColor: colors.surfaceVariant,
    borderRadius: 1,
    zIndex: 0,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
    position: 'relative',
    zIndex: 10,
  },
  timelineRowCompleted: {
    opacity: 0.6,
  },
  nodeColumn: {
    width: 48,
    alignItems: 'center',
    paddingTop: 4,
    zIndex: 10,
  },
  completedNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingNode: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
  },
  contentColumn: {
    flex: 1,
    paddingTop: 4,
    paddingBottom: spacing.md,
  },
  contentDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceVariant + '80', // 50% opacity
  },
  standardLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 4,
  },
  standardAddress: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  completedAddress: {
    textDecorationLine: 'line-through',
    textDecorationColor: colors.outlineVariant,
  },
  standardTime: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },

  // Active Row
  timelineRowActive: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginLeft: -spacing.sm,
    width: '108%', // to stretch slightly beyond padding
    ...shadows.sm,
  },
  timelineLineActive: {
    position: 'absolute',
    left: 35,
    top: 24,
    bottom: 24,
    width: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
    zIndex: 0,
  },
  activeNodeRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.primaryFixed, // approx for ring
    ...shadows.sm,
  },
  activeNodeCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.onPrimary,
  },
  activeContent: {
    flex: 1,
    paddingTop: 4,
  },
  activeContentHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  activeLabelCaps: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  etaBadge: {
    backgroundColor: colors.primaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  etaBadgeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onPrimaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  activeAddress: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  transitStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  transitStatusText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
});

export default MultiDropProgressScreen;
