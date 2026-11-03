import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppHeader } from '../../components/molecules/AppHeader';
import { StatusBadge } from '../../components/atoms/StatusBadge';
import { TripFinancialDetails } from '../../components/trips/TripFinancialDetails';
import { useTripFinancialRecord } from '../../hooks/useTripFinancialRecord';
import { historyStatus, historyTime } from '../../services/trip/tripHistoryPresentation';
import { colors, spacing, typography, borderRadius } from '../../theme';
import type { EarningsScreenProps } from '../../types/navigation';

export function TripEarningsDetailScreen({ navigation, route, testID }: EarningsScreenProps<'TripEarningsDetail'> & { testID?: string }) {
  const state = useTripFinancialRecord(route.params.tripId);
  return <SafeAreaView style={styles.root} edges={['top', 'left', 'right']} testID={testID}>
    <AppHeader title="Trip Earnings" showBackButton onBackPress={() => navigation.goBack()} />
    <ScrollView contentContainerStyle={styles.content}>
      {state.loading ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading trip earnings" /> : null}
      {state.error ? <><Text style={styles.body} accessibilityRole="alert">{state.error}</Text><Pressable accessibilityRole="button" style={styles.action} onPress={state.refresh}><Text style={styles.link}>Retry</Text></Pressable></> : null}
      {state.trip ? <View style={styles.card}><Text style={styles.title}>Trip {state.trip.externalRef}</Text>
        <Text style={styles.body}>{historyTime(state.trip.assignedAt)}</Text><StatusBadge {...historyStatus(state.trip.status)} />
        <TripFinancialDetails earning={state.earning} loading={state.loading} />
      </View> : null}
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface }, content: { padding: spacing.containerPadding, gap: spacing.containerPadding },
  card: { padding: spacing.containerPadding, gap: spacing.sm, borderRadius: borderRadius.xl, backgroundColor: colors.surfaceContainerLowest },
  title: { ...typography.headlineSm, color: colors.onSurface }, body: { ...typography.bodyMd, color: colors.onSurfaceMuted },
  action: { minHeight: 48, justifyContent: 'center' }, link: { ...typography.bodyMd, color: colors.startupBlue },
});
export default TripEarningsDetailScreen;
