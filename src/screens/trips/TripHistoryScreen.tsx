import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, RefreshControl } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { AppHeader } from '../../components/molecules/AppHeader';
import { TripHistoryCard } from '../../components/trips/TripHistoryCard';
import { TripLoadingSkeleton } from '../../components/trips/TripLoadingSkeleton';
import { TripSegmentedFilters } from '../../components/trips/TripSegmentedFilters';
import { useTripHistory } from '../../hooks/useTripHistory';
import { useI18n } from '../../i18n';
import type { TripHistoryFilter, TripHistoryRecord } from '../../types/tripHistory';
import type { TripsScreenProps } from '../../types/navigation';

const descriptions = { all: 'Your trip history will appear here once a trip is completed or cancelled.', completed: 'Your completed trips will appear here.', cancelled: 'Your cancelled trips will appear here.' };

export function TripHistoryScreen({ navigation, testID }: { navigation: TripsScreenProps<'TripHistory'>['navigation']; testID?: string }) {
  const history = useTripHistory();
  const { t } = useI18n();
  const refresh = history.refresh;
  const [activeTab, setActiveTab] = useState<TripHistoryFilter>('all');
  const items = useMemo(() => history.items.filter(trip => activeTab === 'all' || trip.status === (activeTab === 'completed' ? 'COMPLETED' : 'CANCELLED')), [history.items, activeTab]);
  const openTrip = useCallback((tripId: string) => navigation.navigate('HistoricalTripDetail', { tripId }), [navigation]);
  const renderTrip = useCallback(({ item }: { item: TripHistoryRecord }) => <TripHistoryCard trip={item} onPress={openTrip} financeLoading={history.financeLoading} />, [openTrip, history.financeLoading]);
  const retry = useCallback(() => { refresh().catch(() => {}); }, [refresh]);
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']} testID={testID}>
    <AppHeader title={t('tripHistory.title')} showBackButton={false} />
    <TripSegmentedFilters selected={activeTab} counts={history.counts} onSelect={setActiveTab} />
    <FlatList data={items} keyExtractor={item => item.id} renderItem={renderTrip} contentContainerStyle={styles.list}
      initialNumToRender={8} maxToRenderPerBatch={8} windowSize={7}
      refreshControl={<RefreshControl refreshing={history.refreshing} onRefresh={retry} />}
      ListHeaderComponent={<>
        {history.truncated ? <Text style={styles.note}>Showing recent trips. Older trips and total counts are currently unavailable.</Text> : null}
        {history.error && history.items.length > 0 ? <Text accessibilityRole="alert" style={styles.note}>{history.error}</Text> : null}
        {history.financeError ? <Text accessibilityRole="alert" style={styles.note}>{history.financeError}</Text> : null}
        {(history.financeError || (history.error && history.items.length > 0)) ? <Pressable style={styles.retry} accessibilityRole="button" onPress={retry}><Text style={styles.retryText}>Retry</Text></Pressable> : null}
      </>}
      ListEmptyComponent={<View style={styles.empty}>
        {history.loading || (!history.ready && !history.error) ? <TripLoadingSkeleton />
          : history.error ? <><Text style={styles.title}>Could not load trips</Text><Text style={styles.subtitle} accessibilityRole="alert">{history.error}</Text>
            <Pressable style={styles.retry} accessibilityRole="button" onPress={retry}><Text style={styles.retryText}>Retry</Text></Pressable></>
          : history.truncated ? <><Text style={styles.title}>Limited trip history</Text><Text style={styles.subtitle}>No matching trips in the recent records. Older matching trips may be unavailable.</Text></>
          : <><Icon name="history_toggle_off" size={64} color={colors.onSurfaceMuted} /><Text style={styles.title}>No trips found</Text><Text style={styles.subtitle}>{descriptions[activeTab]}</Text></>}
      </View>} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  list: { flexGrow: 1, paddingBottom: spacing.lg, width: '100%', maxWidth: 800, alignSelf: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.containerPadding, gap: spacing.sm },
  title: { ...typography.headlineMd, color: colors.onSurface }, subtitle: { ...typography.bodyMd, color: colors.onSurfaceMuted, textAlign: 'center' },
  note: { ...typography.bodyMd, color: colors.onSurfaceMuted, padding: spacing.containerPadding },
  retry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.containerPadding }, retryText: { ...typography.bodyMd, color: colors.startupBlue, fontWeight: '600' },
});
export default TripHistoryScreen;
