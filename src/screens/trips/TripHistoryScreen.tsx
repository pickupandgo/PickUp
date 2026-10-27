import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useI18n } from '../../i18n';
import { TripService } from '../../services/trip/TripService';
import { DriverTripHistorySkeleton, useSkeletonVisibility } from '../../components/skeleton';
import type { HistoricalTrip } from '../../types/trip';
import type { TripsScreenProps } from '../../types/navigation';

type FilterTab = 'all' | 'completed' | 'cancelled';

export interface TripHistoryScreenProps {
  readonly navigation: TripsScreenProps<'TripHistory'>['navigation'];
  readonly testID?: string;
}

const formatVehicleName = (rawType?: string): string => {
  if (!rawType) return 'Mini Truck';
  const clean = rawType.trim().toUpperCase();
  const map: Record<string, string> = {
    TWO_WHEELER: 'Two Wheeler (Bike)',
    THREE_WHEELER: '3 Wheeler (Tempo)',
    TATA_ACE: 'Tata Ace (Chhota Hathi)',
    PICKUP_8FT: '8ft Pickup',
    PICKUP: 'Pickup Truck',
    MINI_TRUCK: 'Mini Truck',
    TRUCK: 'Commercial Truck',
  };
  return map[clean] || rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

const getVehicleIcon = (rawType?: string): string => {
  if (!rawType) return 'local_shipping';
  const clean = rawType.toUpperCase();
  if (clean.includes('TWO_WHEELER') || clean.includes('BIKE')) return 'two_wheeler';
  if (clean.includes('THREE_WHEELER') || clean.includes('AUTO') || clean.includes('TEMPO')) return 'electric_rickshaw';
  return 'local_shipping';
};

export const TripHistoryScreen: React.FC<TripHistoryScreenProps> = ({ navigation, testID }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [trips, setTrips] = useState<HistoricalTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const uid = getAuth().currentUser?.uid;
  const cacheKey = uid ? `driver.trips.${uid}` : null;

  // Restore cached trips immediately on mount
  useEffect(() => {
    if (!cacheKey) return;
    let isMounted = true;
    AsyncStorage.getItem(cacheKey)
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
  }, [cacheKey]);

  const showSkeleton = useSkeletonVisibility({
    isLoading: loading,
    hasData: trips.length > 0,
  });

  const fetchTrips = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const data = await TripService.getInstance().getHistory();
      setTrips(data);
      if (cacheKey && Array.isArray(data)) {
        AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => {});
      }
    } catch (err) {
      console.warn('Failed to load trips history:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cacheKey]);

  useFocusEffect(
    useCallback(() => {
      void fetchTrips(false);
    }, [fetchTrips]),
  );

  const filteredTrips = useMemo(() => {
    return trips.filter((trip) =>
      activeTab === 'all' ? true : trip.status === activeTab,
    );
  }, [trips, activeTab]);

  const allCount = trips.length;
  const completedCount = useMemo(() => trips.filter((t) => t.status === 'completed').length, [trips]);
  const cancelledCount = useMemo(() => trips.filter((t) => t.status === 'cancelled').length, [trips]);

  const tabs: { key: FilterTab; label: string; count: number }[] = useMemo(() => [
    { key: 'all', label: t('tripHistory.all'), count: allCount },
    { key: 'completed', label: t('tripHistory.completed'), count: completedCount },
    { key: 'cancelled', label: t('tripHistory.cancelled'), count: cancelledCount },
  ], [t, allCount, completedCount, cancelledCount]);

  const handleTripPress = useCallback(
    (trip: HistoricalTrip) => {
      navigation.navigate('HistoricalTripDetail', { tripId: trip.id, trip });
    },
    [navigation],
  );

  const renderTripCard = useCallback(
    ({ item }: { item: HistoricalTrip }) => {
      const isCancelled = item.status === 'cancelled';
      const pickup = item.stops[0];
      const drop = item.stops.length > 1 ? item.stops[item.stops.length - 1] : null;
      const vehicleName = formatVehicleName(item.vehicleType);
      const vehicleIcon = getVehicleIcon(item.vehicleType);

      return (
        <Pressable
          style={({ pressed }) => [
            styles.card,
            isCancelled && styles.cardCancelled,
            pressed && styles.cardPressed,
          ]}
          onPress={() => handleTripPress(item)}
          accessibilityRole="button"
          accessibilityLabel={`Trip ${item.id}, ${item.status}, ${item.date}`}
        >
          {/* Header row: Date + Time + Status Badge */}
          <View style={styles.cardHeader}>
            <View style={styles.headerDateGroup}>
              <Icon name="event" size={14} color={colors.onSurfaceVariant} />
              <Text style={styles.dateText}>
                {item.date} {item.time ? `• ${item.time}` : ''}
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                isCancelled ? styles.badgeCancelled : styles.badgeCompleted,
              ]}
            >
              <Icon
                name={isCancelled ? 'cancel' : 'check_circle'}
                size={12}
                color={isCancelled ? '#DC2626' : '#15803D'}
              />
              <Text
                style={[
                  styles.badgeText,
                  isCancelled ? styles.badgeTextCancelled : styles.badgeTextCompleted,
                ]}
              >
                {isCancelled ? t('common.cancelled') : t('common.completed')}
              </Text>
            </View>
          </View>

          {/* Vehicle & Reference Info */}
          <View style={styles.vehicleRow}>
            <View style={[styles.vehicleIconContainer, isCancelled && styles.vehicleIconCancelled]}>
              <Icon name={vehicleIcon} size={20} color={isCancelled ? colors.onSurfaceVariant : colors.primary} />
            </View>
            <View style={styles.vehicleInfoCol}>
              <Text style={styles.vehicleTitle} numberOfLines={1}>
                {vehicleName}
              </Text>
              <View style={styles.refPill}>
                <Text style={styles.refText} numberOfLines={1}>
                  {item.vehicleRegistration || `#${item.id.slice(0, 8)}`}
                </Text>
              </View>
            </View>
            <View style={styles.amountCol}>
              <Text style={[styles.amountText, isCancelled && styles.amountTextMuted]}>
                {item.earnings.currency}
                {item.earnings.netEarning.toFixed(2)}
              </Text>
              <Text style={styles.amountLabel}>
                {isCancelled ? 'Net Fare' : 'Earned'}
              </Text>
            </View>
          </View>

          {/* Connected Journey Route */}
          <View style={styles.routeContainer}>
            {/* Visual Timeline Bar */}
            <View style={styles.timelineBar}>
              <View style={styles.pickupDot} />
              <View style={styles.connectorLine} />
              <View style={[styles.dropDot, isCancelled && styles.dropDotCancelled]} />
            </View>

            {/* Addresses */}
            <View style={styles.routeAddresses}>
              <View style={styles.addressBlock}>
                <Text style={styles.addressTypeLabel}>PICKUP</Text>
                <Text style={styles.addressText} numberOfLines={1}>
                  {pickup?.address || 'Pickup location'}
                </Text>
              </View>

              <View style={[styles.addressBlock, { marginTop: 10 }]}>
                <Text style={[styles.addressTypeLabel, isCancelled && styles.addressTypeLabelCancelled]}>
                  {item.stops.length > 2 ? `DROP-OFF (1 of ${item.stops.length - 1})` : 'DROP-OFF'}
                </Text>
                <Text style={[styles.addressText, isCancelled && styles.addressTextCancelled]} numberOfLines={1}>
                  {drop?.address ?? (isCancelled ? 'Trip cancelled before drop-off' : 'Destination')}
                </Text>
              </View>
            </View>
          </View>

          {/* Footer separator & details prompt */}
          <View style={styles.footerRow}>
            <View style={styles.footerLeft}>
              {isCancelled ? (
                <>
                  <Icon name="info" size={14} color="#94A3B8" />
                  <Text style={styles.footerCancelledReason} numberOfLines={1}>
                    {item.cancellationReason || t('tripHistory.cancelledByUser')}
                  </Text>
                </>
              ) : (
                <>
                  <Icon name="account_balance_wallet" size={14} color="#15803D" />
                  <Text style={styles.footerPaidLabel}>
                    {t('tripHistory.paidToWallet')}
                  </Text>
                </>
              )}
            </View>

            <View style={styles.detailsAction}>
              <Text style={styles.detailsActionText}>View Details</Text>
              <Icon name="chevron_right" size={16} color={colors.primary} />
            </View>
          </View>
        </Pressable>
      );
    },
    [handleTripPress, t],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top']}>
      <AppHeader title={t('tripHistory.title')} showBackButton={false} />

      {/* Pill Filter Tabs with Counts */}
      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
              onPress={() => setActiveTab(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, selected ? styles.chipTextSelected : styles.chipTextUnselected]}>
                {tab.label} ({tab.count})
              </Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={filteredTrips}
        keyExtractor={(item) => item.id}
        renderItem={renderTripCard}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void fetchTrips(true)}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          showSkeleton ? (
            <DriverTripHistorySkeleton testID="driver-trip-history-loading" count={3} />
          ) : (
            <View style={styles.empty}>
              <View style={styles.emptyIconCircle}>
                <Icon name="history" size={44} color={colors.primary} />
              </View>
              <Text style={styles.emptyTitle}>{t('tripHistory.emptyTitle')}</Text>
              <Text style={styles.emptySubtitle}>{t('tripHistory.emptySubtitle')}</Text>
            </View>
          )
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  chip: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 7,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: '#0F172A',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  chipUnselected: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipText: {
    ...typography.labelSm,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: '#FFFFFF',
  },
  chipTextUnselected: {
    color: '#475569',
  },
  listContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.containerPadding,
    flexGrow: 1,
  },
  separator: {
    height: spacing.sm,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.containerPadding,
    ...shadows.sm,
  },
  cardCancelled: {
    borderColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.995 }],
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerDateGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dateText: {
    ...typography.labelSm,
    color: '#64748B',
    fontWeight: '500',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  badgeCompleted: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#BBF7D0',
  },
  badgeCancelled: {
    backgroundColor: '#FEE2E2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badgeTextCompleted: {
    color: '#15803D',
  },
  badgeTextCancelled: {
    color: '#B91C1C',
  },
  vehicleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  vehicleIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleIconCancelled: {
    backgroundColor: '#F1F5F9',
  },
  vehicleInfoCol: {
    flex: 1,
    gap: 3,
  },
  vehicleTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  refPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  refText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  amountCol: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  amountTextMuted: {
    color: '#94A3B8',
  },
  amountLabel: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  routeContainer: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    marginVertical: spacing.xs,
  },
  timelineBar: {
    alignItems: 'center',
    width: 18,
    paddingTop: 4,
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#16A34A',
  },
  connectorLine: {
    width: 1.5,
    height: 28,
    backgroundColor: '#CBD5E1',
    marginVertical: 2,
  },
  dropDot: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: '#2563EB',
  },
  dropDotCancelled: {
    backgroundColor: '#94A3B8',
  },
  routeAddresses: {
    flex: 1,
    paddingLeft: spacing.xs,
  },
  addressBlock: {
    gap: 1,
  },
  addressTypeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
    letterSpacing: 0.5,
  },
  addressTypeLabelCancelled: {
    color: '#94A3B8',
  },
  addressText: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '500',
  },
  addressTextCancelled: {
    color: '#64748B',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    marginTop: 2,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  footerPaidLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#15803D',
  },
  footerCancelledReason: {
    fontSize: 12,
    color: '#64748B',
    flex: 1,
  },
  detailsAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  detailsActionText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.xs,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
    marginTop: spacing.xs,
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 260,
  },
});

export default TripHistoryScreen;
