import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { mockHistoricalTrip } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useI18n } from '../../i18n';
import type { HistoricalTrip } from '../../types/trip';
import type { TripsScreenProps } from '../../types/navigation';

type FilterTab = 'all' | 'completed' | 'cancelled';

export interface TripHistoryScreenProps {
  readonly navigation: TripsScreenProps<'TripHistory'>['navigation'];
  readonly testID?: string;
}

export const TripHistoryScreen: React.FC<TripHistoryScreenProps> = ({ navigation, testID }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const allTrips: HistoricalTrip[] = [
    mockHistoricalTrip,
    {
      ...mockHistoricalTrip,
      id: 'LOG-9920',
      date: 'Oct 23, 2023',
      time: '2:15 PM',
      vehicleType: 'Heavy Truck',
      vehicleRegistration: 'LOG-4402',
      status: 'cancelled' as const,
      earnings: { ...mockHistoricalTrip.earnings, tripId: 'LOG-9920', netEarning: 0, grossEarning: 0, paidToWallet: false },
    },
    {
      ...mockHistoricalTrip,
      id: 'LOG-9919',
      date: 'Oct 22, 2023',
      time: '9:00 AM',
      goodsType: 'Furniture',
      earnings: { ...mockHistoricalTrip.earnings, tripId: 'LOG-9919', grossEarning: 2200, netEarning: 1760 },
    },
  ];

  const filteredTrips = allTrips.filter((trip) =>
    activeTab === 'all' ? true : trip.status === activeTab,
  );

  const handleTripPress = useCallback(
    (tripId: string) => navigation.navigate('HistoricalTripDetail', { tripId }),
    [navigation],
  );

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'all', label: t('tripHistory.all') },
    { key: 'completed', label: t('tripHistory.completed') },
    { key: 'cancelled', label: t('tripHistory.cancelled') },
  ];

  const renderTripCard = useCallback(
    ({ item }: { item: HistoricalTrip }) => {
      const isCancelled = item.status === 'cancelled';
      return (
        <Pressable
          style={[styles.card, isCancelled && styles.cardCancelled]}
          onPress={() => handleTripPress(item.id)}
          accessibilityRole="button"
        >
          {/* Date + status */}
          <View style={styles.cardHeader}>
            <Text style={styles.dateText}>{item.date}</Text>
            <View style={[styles.badge, isCancelled ? styles.badgeCancelled : styles.badgeCompleted]}>
              <Text style={[styles.badgeText, isCancelled ? styles.badgeTextCancelled : styles.badgeTextCompleted]}>
                {isCancelled ? t('common.cancelled') : t('common.completed')}
              </Text>
            </View>
          </View>

          {/* Vehicle + route */}
          <View style={styles.midRow}>
            <View style={styles.truckCircle}>
              <Icon name="local_shipping" size={20} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.midCol}>
              <Text style={[styles.vehicleText, isCancelled && styles.strike]} numberOfLines={1}>
                {item.vehicleType} • {item.vehicleRegistration}
              </Text>
              <View style={styles.metaLine}>
                <Icon name="my_location" size={14} color={colors.onSurfaceVariant} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {item.stops[0]?.address}
                </Text>
              </View>
              {!isCancelled && (
                <View style={styles.metaLine}>
                  <Icon name="pin_drop" size={14} color={colors.onSurfaceVariant} />
                  <Text style={styles.metaText}>{t('tripHistory.stops', { count: item.stops.length })}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Earnings footer */}
          <View style={styles.footer}>
            <View style={styles.footerLeft}>
              {!isCancelled && <Icon name="account_balance_wallet" size={16} color={colors.outline} />}
              <Text style={styles.footerLabel}>
                {isCancelled ? t('tripHistory.cancelledByUser') : t('tripHistory.paidToWallet')}
              </Text>
            </View>
            <Text style={[styles.amount, isCancelled && styles.amountMuted]}>
              {item.earnings.currency}
              {item.earnings.netEarning.toLocaleString('en-IN')}
              {isCancelled ? '.00' : '.00'}
            </Text>
          </View>
        </Pressable>
      );
    },
    [handleTripPress, t],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader title={t('tripHistory.title')} showBackButton={false} />

      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const selected = activeTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.chipText, selected ? styles.chipTextSelected : styles.chipTextUnselected]}>
                {tab.label}
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
        ListEmptyComponent={
          <View style={styles.empty}>
            <Icon name="history_toggle_off" size={80} color={colors.surfaceContainerHighest} />
            <Text style={styles.emptyTitle}>{t('tripHistory.emptyTitle')}</Text>
            <Text style={styles.emptySubtitle}>{t('tripHistory.emptySubtitle')}</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  chip: {
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipUnselected: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  chipText: {
    ...typography.labelSm,
  },
  chipTextSelected: {
    color: colors.onPrimary,
  },
  chipTextUnselected: {
    color: colors.onSurface,
  },
  listContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.containerPadding,
    flexGrow: 1,
  },
  separator: {
    height: spacing.gutter,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
  },
  cardCancelled: {
    opacity: 0.85,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dateText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  badge: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  badgeCompleted: {
    backgroundColor: colors.secondaryContainer,
  },
  badgeCancelled: {
    backgroundColor: colors.errorContainer,
  },
  badgeText: {
    ...typography.labelCaps,
  },
  badgeTextCompleted: {
    color: colors.onSecondaryContainer,
  },
  badgeTextCancelled: {
    color: colors.onErrorContainer,
  },
  midRow: {
    flexDirection: 'row',
    gap: spacing.gutter,
    alignItems: 'flex-start',
  },
  truckCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  midCol: {
    flex: 1,
    gap: 2,
  },
  vehicleText: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  strike: {
    textDecorationLine: 'line-through',
    color: colors.onSurfaceVariant,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    paddingTop: spacing.gutter,
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerLabel: {
    ...typography.labelSm,
    color: colors.outline,
  },
  amount: {
    ...typography.headlineMd,
    color: colors.primary,
  },
  amountMuted: {
    color: colors.outline,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.xs,
  },
  emptyTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
    marginTop: spacing.gutter,
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    maxWidth: 250,
  },
});

export default TripHistoryScreen;
