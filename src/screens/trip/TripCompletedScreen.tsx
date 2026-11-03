import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { tripCompletedLabels } from '../../data/mockData';
import { JourneyRecap } from '../../components/organisms/JourneyRecap';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { TripController } from '../../services/trip/TripController';
import { useCollectableTrips } from '../../hooks/useCollectableTrips';
import { CollectPaymentBanner } from '../../components/molecules/CollectPaymentBanner';
import type { DriverTripDto } from '../../services/payments/collectionsDto';
import type { HomeScreenProps } from '../../types/navigation';
import { useLiveTrip } from '../../hooks/useActiveTrip';
import { useTripHistory } from '../../hooks/useTripHistory';
import { TripFinancialDetails } from '../../components/trips/TripFinancialDetails';
import { DeliveryPhotoGallery } from '../../components/trips/DeliveryPhotoGallery';
import { historicalVehicle } from '../../services/trip/historicalVehicle';

/**
 * TripCompletedScreen
 * Summary screen shown after a trip is completed with earnings and recap.
 */
export interface TripCompletedScreenProps {
  readonly navigation: HomeScreenProps<'TripCompleted'>['navigation'];
  readonly route: HomeScreenProps<'TripCompleted'>['route'];
  readonly testID?: string;
}

export const TripCompletedScreen: React.FC<TripCompletedScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const trip = useLiveTrip(route.params.tripId);
  const history = useTripHistory(route.params.tripId);
  const record = history.items.find(item => item.id === route.params.tripId);
  const completed = trip?.engineStatus === 'COMPLETED' || record?.status === 'COMPLETED';
  const collectable = useCollectableTrips();

  const handleCollect = useCallback(
    (backendTrip: DriverTripDto) =>
      navigation.navigate('CollectPayment', { tripId: backendTrip.tripId }),
    [navigation],
  );

  const handleBackToHome = useCallback(() => {
    // Clear the finished trip and return to the root of HomeStack.
    TripController.getInstance().clearTrip();
    navigation.popToTop();
  }, [navigation]);

  const handleViewEarnings = useCallback(() => {
    navigation.getParent()?.navigate('EarningsTab', { screen: 'EarningsHistory' });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Hero section */}
        <View style={styles.heroSection}>
          <View style={styles.checkIcon}>
            <Icon name={completed ? 'verified' : 'schedule'} style={styles.checkIconText} />
          </View>
          <Text style={styles.title}>{completed ? tripCompletedLabels.title : 'Checking trip completion'}</Text>
        </View>

        {/* Pay-at-delivery fare still to collect (payments backend) */}
        <CollectPaymentBanner trips={collectable} onPress={handleCollect} />

        <TripFinancialDetails earning={record?.earning ?? null} loading={history.financeLoading} />
        {history.error ? <Text style={styles.statValue}>{history.error}</Text> : null}
        {history.financeError ? <Text style={styles.statValue}>{history.financeError}</Text> : null}
        {/* Only verified measurements from the same historical record. */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{record?.weightKg == null ? 'Unavailable' : `${record.weightKg} kg`}</Text>
            <Text style={styles.statLabel}>Weight</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{record?.distanceKm == null ? 'Unavailable' : `${record.distanceKm} km`}</Text>
            <Text style={styles.statLabel}>{tripCompletedLabels.distanceLabel}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{record ? record.stops.length : '—'}</Text>
            <Text style={styles.statLabel}>{tripCompletedLabels.stopsLabel}</Text>
          </View>
        </View>

        {/* Journey Recap */}
        <View style={styles.recapSection}>
          <Text style={styles.recapTitle}>{tripCompletedLabels.journeyRecapTitle}</Text>
          {trip ? <JourneyRecap stops={trip.stops} /> : <Text style={styles.statValue}>Loading trip route…</Text>}
          {record ? <>
            <Text style={styles.recapTitle}>{historicalVehicle(record).title}</Text>
            <Text style={styles.statValue}>{historicalVehicle(record).detailsNote}</Text>
            <Text style={styles.recapTitle}>Delivery evidence</Text>
            <DeliveryPhotoGallery trip={record} />
          </> : null}
        </View>
      </ScrollView>

      {/* Bottom actions */}
      <View style={styles.actions}>
        <PrimaryButton
          label={tripCompletedLabels.backToHomeLabel}
          onPress={handleBackToHome}
        />
        <SecondaryButton
          label={tripCompletedLabels.viewEarningsLabel}
          onPress={handleViewEarnings}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingTop: spacing.lg,
    gap: spacing.containerPadding,
    paddingBottom: spacing.lg,
  },
  heroSection: {
    alignItems: 'center',
    gap: spacing.containerPadding,
    paddingVertical: spacing.lg,
  },
  checkIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIconText: {
    fontSize: 40,
    color: colors.success,
  },
  title: {
    ...typography.headlineLg,
    color: colors.onSurface,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    ...shadows.sm,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  statLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontSize: 10,
  },
  statDivider: {
    width: 1,
    height: 32,
    backgroundColor: colors.outlineVariant,
  },
  recapSection: {
    gap: spacing.gutter,
  },
  recapTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  actions: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    paddingTop: spacing.gutter,
    gap: spacing.gutter,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    backgroundColor: colors.surface,
  },
});

export default TripCompletedScreen;
