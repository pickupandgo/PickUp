import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { mockTripHistory, TripHistoryItem } from '../../data/mockData';

export interface TripHistoryScreenProps {
  readonly onBack?: () => void;
  readonly onTripSelect?: (trip: TripHistoryItem) => void;
}

const TripHistoryScreen: React.FC<TripHistoryScreenProps & { navigation?: any }> = ({
  onBack,
  onTripSelect,
  navigation,
}) => {
  const [activeTab, setActiveTab] = useState<'Recent' | 'Scheduled'>('Recent');

  // No scheduled mock data exists in this prototype, so that tab renders an empty list.
  const visibleTrips: readonly TripHistoryItem[] = activeTab === 'Recent' ? mockTripHistory : [];

  const renderTripCard = (trip: TripHistoryItem) => {
    const isCompleted = trip.status === 'completed';
    const isCancelled = trip.status === 'cancelled';

    return (
      <Pressable
        key={trip.id}
        style={styles.tripCard}
        onPress={() => {
          onTripSelect?.(trip);
          navigation?.navigate(
            trip.status === 'cancelled' ? 'TripCancelledStatusScreen' : 'HistoricalTripDetailScreen'
          );
        }}
      >
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <View
              style={[
                styles.statusBadge,
                isCompleted && styles.statusBadgeCompleted,
                isCancelled && styles.statusBadgeCancelled,
              ]}
            >
              <View
                style={[
                  styles.statusDot,
                  isCompleted && styles.statusDotCompleted,
                  isCancelled && styles.statusDotCancelled,
                ]}
              />
              <Text
                style={[
                  styles.statusText,
                  isCompleted && styles.statusTextCompleted,
                  isCancelled && styles.statusTextCancelled,
                ]}
              >
                {trip.status.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.dateText}>{trip.date}</Text>
          </View>

          <View style={styles.cardHeaderRight}>
            <Text style={[styles.amountText, isCancelled && styles.amountTextCancelled]}>
              {trip.amount}
            </Text>
            <Text
              style={[
                styles.paymentText,
                isCancelled && styles.paymentTextCancelled,
              ]}
            >
              {isCancelled ? trip.cancelReason : trip.paymentMethod}
            </Text>
          </View>
        </View>

        <View style={[styles.routeInfo, isCancelled && { opacity: 0.7 }]}>
          <View style={styles.routeTimeline}>
            <View style={[styles.timelineDot, isCompleted ? styles.timelineDotActivePickup : styles.timelineDotInactive]} />
            <View style={styles.timelineLine} />
            <View style={[styles.timelineDot, isCompleted ? styles.timelineDotActiveDrop : styles.timelineDotInactive]} />
          </View>
          <View style={styles.routeLocations}>
            <Text style={styles.locationText}>{trip.from}</Text>
            <Text style={styles.locationText}>{trip.to}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.vehicleInfo}>
            <Feather name="truck" size={14} color={colors.onSurfaceVariant} />
            <Text style={styles.vehicleText}>{trip.vehicleType}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.onSurfaceVariant} />
        </View>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip History</Text>
        {/* Decorative: there is no filter surface in this prototype */}
        <View style={styles.iconButton}>
          <Feather name="filter" size={22} color={colors.primary} />
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Tabs */}
        <View style={styles.tabContainer}>
          <Pressable
            style={[styles.tabButton, activeTab === 'Recent' && styles.tabButtonActive]}
            onPress={() => setActiveTab('Recent')}
          >
            <Text style={[styles.tabText, activeTab === 'Recent' && styles.tabTextActive]}>
              Recent
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tabButton, activeTab === 'Scheduled' && styles.tabButtonActive]}
            onPress={() => setActiveTab('Scheduled')}
          >
            <Text style={[styles.tabText, activeTab === 'Scheduled' && styles.tabTextActive]}>
              Scheduled
            </Text>
          </Pressable>
        </View>

        {/* Trip List */}
        <View style={styles.tripList}>
          {visibleTrips.map(renderTripCard)}
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
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl, // padding for bottom nav if present
  },

  // Tabs
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.full,
    padding: 4,
    marginBottom: spacing.xl,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: colors.primary,
    ...shadows.sm,
  },
  tabText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  tabTextActive: {
    color: colors.onPrimary,
  },

  // Trip List
  tripList: {
    gap: spacing.md,
  },
  tripCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.lg,
    ...shadows.card,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  cardHeaderLeft: {
    gap: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  statusBadgeCompleted: {
    backgroundColor: '#E6F4EA',
  },
  statusBadgeCancelled: {
    backgroundColor: colors.errorContainer,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotCompleted: {
    backgroundColor: '#137333',
  },
  statusDotCancelled: {
    backgroundColor: colors.error,
  },
  statusText: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  statusTextCompleted: {
    color: '#137333',
  },
  statusTextCancelled: {
    color: colors.onErrorContainer,
  },
  dateText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  cardHeaderRight: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  amountTextCancelled: {
    color: colors.onSurfaceVariant,
    textDecorationLine: 'line-through',
  },
  paymentText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  paymentTextCancelled: {
    color: colors.error,
  },

  // Route Info
  routeInfo: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  routeTimeline: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineDotActivePickup: {
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  timelineDotActiveDrop: {
    backgroundColor: colors.secondary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  timelineDotInactive: {
    backgroundColor: colors.outline,
  },
  timelineLine: {
    width: 2,
    height: 32,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
  },
  routeLocations: {
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  locationText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Card Footer
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
  },
  vehicleInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  vehicleText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default TripHistoryScreen;
