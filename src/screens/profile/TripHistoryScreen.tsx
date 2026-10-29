import React, { useState, useEffect, useCallback, useContext } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { getCustomerHistory } from '../../api/engine';
import { BookingContext } from '../../state/BookingContext';
import Button from '../../components/atoms/Button';
import type { Trip } from '../../api/types';
import { getVehicleImage } from '../../utils/vehicleAssets';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TripHistorySkeleton, useSkeletonVisibility } from '../../components/skeleton';

export interface TripHistoryScreenProps {
  readonly onBack?: () => void;
  readonly onTripSelect?: (trip: Trip) => void;
  readonly onBookRide?: () => void;
  readonly onScheduleRide?: () => void;
  readonly onRetry?: () => void;
  readonly customerId?: string;
  readonly initialTrips?: Trip[];
  readonly initialTab?: 'Recent' | 'Scheduled';
  readonly navigation?: any;
}

const TripHistoryScreen: React.FC<TripHistoryScreenProps> = ({
  onBack,
  onTripSelect,
  onBookRide,
  onScheduleRide,
  onRetry,
  customerId: customerIdProp,
  initialTrips,
  initialTab = 'Recent',
  navigation,
}) => {
  const [activeTab, setActiveTab] = useState<'Recent' | 'Scheduled'>(initialTab);
  const booking = useContext(BookingContext);
  const effectiveCustomerId = customerIdProp ?? booking?.customerId;

  const [trips, setTrips] = useState<Trip[]>(initialTrips ?? []);
  const [loading, setLoading] = useState<boolean>(initialTrips === undefined && Boolean(effectiveCustomerId));
  const [error, setError] = useState<string | null>(null);

  const TRIPS_CACHE_KEY = `pickup.trips.${effectiveCustomerId ?? 'guest'}`;

  // Account-specific cache read: immediately render cached data if available
  useEffect(() => {
    if (initialTrips !== undefined || !effectiveCustomerId) return;
    let isMounted = true;
    AsyncStorage.getItem(TRIPS_CACHE_KEY)
      .then((raw) => {
        if (!isMounted || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTrips(parsed);
          }
        } catch {
          // ignore cache parse error
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [TRIPS_CACHE_KEY, effectiveCustomerId, initialTrips]);

  const fetchTrips = useCallback(async () => {
    if (!effectiveCustomerId) {
      setError('Please sign in to view your trip history.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomerHistory(effectiveCustomerId);
      const safeData = Array.isArray(data) ? data : [];
      setTrips(safeData);
      AsyncStorage.setItem(TRIPS_CACHE_KEY, JSON.stringify(safeData)).catch(() => {});
    } catch (err: any) {
      const message =
        err?.userMessage ||
        err?.message ||
        'Failed to load trip history. Please check your connection and try again.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [TRIPS_CACHE_KEY, effectiveCustomerId]);

  const showSkeleton = useSkeletonVisibility({
    isLoading: loading,
    hasData: trips.length > 0,
    isError: Boolean(error),
  });

  useEffect(() => {
    if (initialTrips !== undefined) return;
    fetchTrips();
  }, [fetchTrips, initialTrips]);

  const handleRetry = () => {
    onRetry?.();
    fetchTrips();
  };

  const handleBookRide = () => {
    if (onBookRide) {
      onBookRide();
      return;
    }
    try {
      booking?.startNewBooking?.();
    } catch {
      // safe fallback if outside provider
    }
    if (navigation?.navigate) {
      navigation.navigate('BookingStack', { screen: 'AddressSearchScreen' });
    }
  };

  const handleScheduleRide = () => {
    if (onScheduleRide) {
      onScheduleRide();
      return;
    }
    // No separate scheduling service in this app; navigate to the existing booking entry point
    handleBookRide();
  };

  // No scheduled rides exist in this backend/app, so the scheduled tab has 0 trips.
  const visibleTrips = activeTab === 'Recent' ? trips : [];

  const renderTripCard = (trip: Trip) => {
    const isCompleted = trip.status === 'COMPLETED';
    const isCancelled = trip.status === 'CANCELLED';

    return (
      <Pressable
        key={trip.id}
        style={styles.tripCard}
        onPress={() => {
          onTripSelect?.(trip);
          if (!isCompleted && !isCancelled) {
            navigation?.navigate('ActiveTripStack', { screen: 'CustomerLiveTrackingScreen' });
            return;
          }
          navigation?.navigate(
            isCancelled ? 'TripCancelledStatusScreen' : 'HistoricalTripDetailScreen',
            {
              trip,
              tripId: (trip as any).externalRef || trip.id,
              pickupLocation: trip.pickup?.address,
              dropLocation: trip.stops?.[trip.stops.length - 1]?.location?.address || (trip as any).drop?.address,
              feeAmount: (trip as any).cancellationFee,
            }
          );
        }}
        accessibilityRole="button"
        accessibilityLabel={`Trip on ${new Date(trip.createdAt).toLocaleDateString()}`}
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
            <Text style={styles.dateText}>{new Date(trip.createdAt).toLocaleDateString()}</Text>
          </View>

          <View style={styles.cardHeaderRight}>
            <Text style={[styles.amountText, isCancelled && styles.amountTextCancelled]}>
              {`₹${trip.fare ?? 0}`}
            </Text>
            <Text
              style={[
                styles.paymentText,
                isCancelled && styles.paymentTextCancelled,
              ]}
            >
              {isCancelled ? 'Cancelled by User' : 'CASH'}
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
            <Text style={styles.locationText}>{trip.pickup?.address || 'Pickup location'}</Text>
            <Text style={styles.locationText}>{trip.stops?.[trip.stops.length - 1]?.location?.address || 'No Drop Location'}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.vehicleInfo}>
            <Image
              source={getVehicleImage((trip as any).vehicleType)}
              style={{ width: 18, height: 18, marginRight: 4 }}
              resizeMode="contain"
            />
            <Text style={styles.vehicleText}>{`${trip.weight ?? 0} kg`}</Text>
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
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip History</Text>
        {/* Decorative: there is no filter surface in this prototype */}
        <View style={styles.iconButton} accessibilityRole="none">
          <Feather name="filter" size={22} color={colors.primary} />
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabWrapper}>
        <View style={styles.tabContainer}>
          <Pressable
            testID="tab-recent"
            style={[styles.tabButton, activeTab === 'Recent' && styles.tabButtonActive]}
            onPress={() => setActiveTab('Recent')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'Recent' }}
          >
            <Text style={[styles.tabText, activeTab === 'Recent' && styles.tabTextActive]}>
              Recent
            </Text>
          </Pressable>
          <Pressable
            testID="tab-scheduled"
            style={[styles.tabButton, activeTab === 'Scheduled' && styles.tabButtonActive]}
            onPress={() => setActiveTab('Scheduled')}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'Scheduled' }}
          >
            <Text style={[styles.tabText, activeTab === 'Scheduled' && styles.tabTextActive]}>
              Scheduled
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Tab Content: Loading, Error, Empty, or Trip List */}
      {showSkeleton ? (
        <TripHistorySkeleton testID="trip-history-loading" />
      ) : error && trips.length === 0 ? (
        <View style={styles.stateContainer} testID="trip-history-error">
          <View style={styles.errorIconCircle}>
            <Feather name="alert-circle" size={36} color={colors.error} />
          </View>
          <Text style={styles.stateTitle}>Unable to load rides</Text>
          <Text style={styles.stateDescription}>{error}</Text>
          <Button
            label="Try Again"
            onPress={handleRetry}
            variant="primary"
            size="md"
            style={styles.actionButton}
          />
        </View>
      ) : visibleTrips.length === 0 ? (
        <View
          style={styles.stateContainer}
          testID={activeTab === 'Recent' ? 'empty-recent-state' : 'empty-scheduled-state'}
        >
          <View style={styles.iconCircle}>
            <Feather
              name={activeTab === 'Recent' ? 'clock' : 'calendar'}
              size={36}
              color={colors.primary}
            />
          </View>
          <Text style={styles.stateTitle}>
            {activeTab === 'Recent' ? 'No rides yet' : 'No scheduled rides'}
          </Text>
          <Text style={styles.stateDescription}>
            {activeTab === 'Recent'
              ? 'Your completed and previous rides will appear here once you start riding with MultipleRide.'
              : "You don't have any upcoming scheduled rides. Plan your next trip with MultipleRide."}
          </Text>
          <Button
            label={activeTab === 'Recent' ? 'Book a Ride' : 'Schedule a Ride'}
            onPress={activeTab === 'Recent' ? handleBookRide : handleScheduleRide}
            variant="primary"
            size="md"
            style={styles.actionButton}
          />
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchTrips}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          <View style={styles.tripList}>
            {visibleTrips.map(renderTripCard)}
          </View>
        </ScrollView>
      )}
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
  tabWrapper: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.full,
    padding: 4,
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
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
  },
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
  stateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#E6F4FE',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  errorIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.errorContainer,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  stateTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  stateDescription: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    marginBottom: spacing.xl,
    maxWidth: 290,
  },
  actionButton: {
    minWidth: 160,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
});

export default TripHistoryScreen;
