import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ScrollView, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import { HomeBrandMark } from '../../components/molecules/HomeArtwork';
import { VehicleAvatar } from '../../components/atoms/VehicleAvatar';
import { colors } from '../../theme';
import { useEngineTripHistory as useTripHistory } from '../../hooks/useEngineTripHistory';
import { fareText } from '../../services/payments/money';
import { label } from '../../services/onboarding/onboardingPresentation';
import { useI18n } from '../../i18n';
import type { HistoricalTrip } from '../../types/trip';
import type { TripsScreenProps } from '../../types/navigation';

type FilterTab = 'all' | 'completed' | 'cancelled';
interface HistoryRow { readonly trip: HistoricalTrip; readonly showDate: boolean }
export interface TripHistoryScreenProps {
  readonly navigation: TripsScreenProps<'TripHistory'>['navigation'];
  readonly testID?: string;
}

const vehicles: Record<string, { title: string; artwork: React.ComponentProps<typeof VehicleAvatar>['vehicle'] }> = {
  TWO_WHEELER: { title: 'Bike / 2-Wheeler', artwork: 'TWO_WHEELER' },
  THREE_WHEELER: { title: '3-Wheeler', artwork: 'THREE_WHEELER' },
  FOUR_WHEELER: { title: '4-Wheeler', artwork: 'FOUR_WHEELER' },
  MINI_TRUCK: { title: 'Mini Truck', artwork: 'MINI_TRUCK' },
  PICKUP_TRUCK: { title: 'Pickup / Bolero', artwork: 'PICKUP_TRUCK' },
  PICKUP: { title: 'Pickup / Bolero', artwork: 'PICKUP_TRUCK' },
};
const vehicleDisplay = (value: string) => vehicles[value.toUpperCase().replace(/[\s-]+/g, '_')];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateLabel(date: string) {
  // History already supplies a device-local en-IN date. Do not reinterpret its timezone.
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (!match) return date;
  const day = Number(match[1]), month = Number(match[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12 ? `${day} ${months[month - 1]} ${match[3]}` : date;
}

export const TripHistoryScreen: React.FC<TripHistoryScreenProps> = ({ navigation, testID }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { trips: allTrips, isLoading, error, fetchHistory, nextCursor, loadMore } = useTripHistory();
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groups = new Map<string, HistoricalTrip[]>();
    allTrips.forEach(trip => {
      if (activeTab !== 'all' && trip.status !== activeTab) return;
      const searchText = [trip.id, trip.date, dateLabel(trip.date), trip.vehicleType,
        vehicleDisplay(trip.vehicleType)?.title, trip.vehicleRegistration, ...trip.stops.map(stop => stop.address)].join(' ').toLowerCase();
      if (needle && !searchText.includes(needle)) return;
      const group = groups.get(trip.date) ?? [];
      group.push(trip); groups.set(trip.date, group);
    });
    return Array.from(groups.values()).flatMap(group => group.map((trip, index) => ({ trip, showDate: index === 0 })));
  }, [allTrips, activeTab, query]);

  const handleTripPress = useCallback((tripId: string) => navigation.navigate('HistoricalTripDetail', { tripId }), [navigation]);
  const tabs: { key: FilterTab; title: string }[] = [
    { key: 'all', title: t('tripHistory.all') },
    { key: 'completed', title: t('tripHistory.completed') },
    { key: 'cancelled', title: t('tripHistory.cancelled') },
  ];
  const renderTripCard = useCallback(({ item }: { item: HistoryRow }) => {
    const trip = item.trip;
    const cancelled = trip.status === 'cancelled', completed = trip.status === 'completed';
    const status = cancelled ? t('common.cancelled') : completed ? t('common.completed') : label(trip.status);
    const vehicle = vehicleDisplay(trip.vehicleType);
    const pickup = trip.stops.find(stop => stop.type === 'pickup');
    const drops = trip.stops.filter(stop => stop.type !== 'pickup');
    const finalDrop = drops[drops.length - 1];
    return <View>
      {item.showDate && <Text style={styles.dateHeading} accessibilityRole="header">{dateLabel(trip.date)}</Text>}
      <Pressable onPress={() => handleTripPress(trip.id)} accessibilityRole="button" accessibilityLabel={`Open trip ${trip.id}`}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.vehicleRow}>
          <View style={styles.vehiclePicture}>
            {vehicle ? <VehicleAvatar vehicle={vehicle.artwork} size={43} /> : <Icon name="local_shipping" size={25} color={colors.onSurfaceMuted} />}
          </View>
          <View style={styles.vehicleDivider} />
          <View style={styles.vehicleText}>
            <Text style={styles.vehicleTitle} numberOfLines={1}>{vehicle?.title ?? label(trip.vehicleType)}</Text>
            {!cancelled && trip.stops.length > 1 && <Text style={styles.stopCount}>{t('tripHistory.stops', { count: trip.stops.length })}</Text>}
          </View>
          <View style={[styles.badge, completed && styles.completedBadge, cancelled && styles.cancelledBadge]}>
            <View style={[styles.statusDot, completed && styles.completedDot, cancelled && styles.cancelledDot]} />
            <Text style={[styles.badgeText, completed && styles.completedText, cancelled && styles.cancelledText]}>{status}</Text>
          </View>
        </View>
        <View style={styles.route}>
          <View style={styles.routeLine} />
          <View style={styles.routeRow}>
            <View style={styles.marker}><View style={styles.pickupDot} /></View>
            <View style={styles.addressColumn}>
              <Text style={styles.routeLabel}>PICKUP</Text>
              <Text style={styles.address} numberOfLines={1}>{pickup?.address || 'Pickup unavailable'}</Text>
            </View>
          </View>
          <View style={styles.routeRow}>
            <View style={styles.marker}><Icon name="place" size={12} color={colors.primary} /></View>
            <View style={styles.addressColumn}>
              {finalDrop?.address && <Text style={styles.routeLabel}>{drops.length > 1 ? 'FINAL DROP' : 'DROP'}</Text>}
              <Text style={[styles.address, !finalDrop?.address && styles.unavailable]} numberOfLines={1}>
                {finalDrop?.address || 'Drop details unavailable'}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.footer}>
          <Icon name="account_balance_wallet" size={14} color={colors.onSurfaceMuted} />
          <Text style={styles.footerLabel}>Customer fare</Text>
          <Text style={styles.amount}>{fareText(trip.customerFarePaise)}</Text>
          <Icon name="chevron_right" size={19} color={colors.onSurfaceMuted} />
        </View>
      </Pressable>
    </View>;
  }, [handleTripPress, t]);

  return <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']} testID={testID}>
    <View style={styles.header}>
      <HomeBrandMark />
      <View style={styles.headerDivider} />
      <Text style={styles.headerTitle}>Trip history</Text>
      <Pressable onPress={() => { setSearchOpen(!searchOpen); setQuery(''); }} style={styles.headerButton}
        accessibilityRole="button" accessibilityLabel={searchOpen ? 'Close trip search' : 'Search trips'} accessibilityState={{ expanded: searchOpen }}>
        <Icon name={searchOpen ? 'close' : 'search'} size={23} color={colors.primary} />
      </Pressable>
    </View>
    {searchOpen && <View style={styles.searchRow}>
      <Icon name="search" size={19} color={colors.onSurfaceMuted} />
      <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search loaded trips" placeholderTextColor={colors.onSurfaceMuted}
        accessibilityLabel="Search loaded trips" style={styles.searchInput} returnKeyType="search" autoCorrect={false} />
    </View>}
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabRow}>
        {tabs.map(tab => <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} hitSlop={{ top: 6, bottom: 6 }}
          accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab.key }}
          style={[styles.chip, activeTab === tab.key && styles.selectedChip]}>
          <Text style={[styles.chipText, activeTab === tab.key && styles.selectedChipText]}>{tab.title}</Text>
        </Pressable>)}
      </ScrollView>
    </View>
    <FlatList data={rows} keyExtractor={item => item.trip.id} renderItem={renderTripCard}
      refreshing={isLoading} onRefresh={fetchHistory} contentContainerStyle={styles.listContent}
      ItemSeparatorComponent={Separator} showsVerticalScrollIndicator={false} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
      ListHeaderComponent={error ? <Pressable onPress={fetchHistory} accessibilityRole="button" style={styles.notice}>
        <Text style={styles.error} accessibilityRole="alert">{error} Tap to retry.</Text>
      </Pressable> : undefined}
      ListFooterComponent={nextCursor ? <Pressable onPress={loadMore} disabled={isLoading} accessibilityRole="button" style={styles.loadMore}>
        <Text style={styles.loadMoreText}>{isLoading ? 'Loading...' : 'Load more trips'}</Text>
      </Pressable> : undefined}
      ListEmptyComponent={isLoading ? <View style={styles.empty}><ActivityIndicator color={colors.homeGreen} /><Text style={styles.emptySubtitle}>Loading trips...</Text></View> : error ? undefined :
        <View style={styles.empty}>
          <Icon name="history" size={32} color={colors.onSurfaceMuted} />
          <Text style={styles.emptyTitle}>{query.trim() ? 'No matching trips' : t('tripHistory.emptyTitle')}</Text>
          <Text style={styles.emptySubtitle}>{query.trim() ? 'Search applies to loaded trips. Load more or change your search.' : t('tripHistory.emptySubtitle')}</Text>
        </View>}
    />
  </SafeAreaView>;
};
function Separator() { return <View style={styles.separator} />; }
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 16, backgroundColor: colors.surfaceContainerLowest, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.homeBorder },
  headerDivider: { width: 1, height: 24, backgroundColor: colors.homeBorder },
  headerTitle: { flex: 1, fontSize: 16, lineHeight: 21, fontWeight: '600', color: colors.primary },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabRow: { paddingHorizontal: 16, paddingVertical: 12, gap: 9, alignItems: 'center' },
  chip: { minHeight: 28, justifyContent: 'center', paddingVertical: 5, paddingHorizontal: 13, borderRadius: 8, borderWidth: 1, borderColor: colors.outlineSubtle, backgroundColor: colors.transparent },
  selectedChip: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 11, lineHeight: 16, fontWeight: '400', color: colors.onSurfaceVariant },
  selectedChipText: { color: colors.onPrimary, fontWeight: '500' },
  listContent: { paddingHorizontal: 12, paddingBottom: 24, flexGrow: 1 },
  dateHeading: { fontSize: 11, lineHeight: 16, fontWeight: '600', color: colors.onSurfaceMuted, marginTop: 2, marginBottom: 10, marginLeft: 4 },
  separator: { height: 12 },
  card: { borderRadius: 11, borderWidth: 1, borderColor: colors.homeBorder, paddingHorizontal: 12, paddingTop: 9, backgroundColor: colors.surfaceContainerLowest },
  pressed: { opacity: 0.75 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 37, marginBottom: 9 },
  vehiclePicture: { width: 47, alignItems: 'center', justifyContent: 'center' },
  vehicleDivider: { width: 1, height: 25, backgroundColor: colors.homeBorder },
  vehicleText: { flex: 1, minWidth: 0, gap: 1 },
  vehicleTitle: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: colors.primary },
  stopCount: { fontSize: 10, lineHeight: 14, color: colors.onSurfaceMuted },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 12, backgroundColor: colors.surfaceContainerLow, maxWidth: '43%' },
  completedBadge: { backgroundColor: colors.homeMint },
  cancelledBadge: { backgroundColor: colors.historyCancelledSurface },
  statusDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.homeMuted },
  completedDot: { backgroundColor: colors.homeGreen },
  cancelledDot: { backgroundColor: colors.error },
  badgeText: { fontSize: 10, lineHeight: 14, fontWeight: '500', color: colors.onSurfaceMuted, flexShrink: 1 },
  completedText: { color: colors.homeGreen },
  cancelledText: { color: colors.error },
  route: { gap: 7, marginBottom: 10, position: 'relative' },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24 },
  routeLine: { position: 'absolute', left: 5.5, top: 12, bottom: 12, width: 1, backgroundColor: colors.homeBorder },
  marker: { width: 12, alignItems: 'center', justifyContent: 'center' },
  pickupDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.homeGreen },
  addressColumn: { flex: 1, minWidth: 0 },
  routeLabel: { fontSize: 8, lineHeight: 11, color: colors.onSurfaceMuted },
  address: { fontSize: 12, lineHeight: 17, color: colors.primary },
  unavailable: { color: colors.onSurfaceMuted, fontStyle: 'italic', fontSize: 11 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.homeBorder, minHeight: 36, paddingVertical: 8 },
  footerLabel: { flex: 1, fontSize: 10, lineHeight: 14, color: colors.onSurfaceMuted },
  amount: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.primary, flexShrink: 1 },
  searchRow: { marginHorizontal: 16, marginTop: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 9, backgroundColor: colors.surfaceContainerLowest },
  searchInput: { flex: 1, minHeight: 44, fontSize: 13, color: colors.primary },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 9, paddingVertical: 48, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 15, lineHeight: 21, fontWeight: '500', color: colors.primary, textAlign: 'center' },
  emptySubtitle: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted, textAlign: 'center' },
  notice: { paddingVertical: 12 },
  error: { fontSize: 12, lineHeight: 18, color: colors.error },
  loadMore: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 12 },
  loadMoreText: { fontSize: 12, lineHeight: 18, color: colors.primary },
});
export default TripHistoryScreen;
