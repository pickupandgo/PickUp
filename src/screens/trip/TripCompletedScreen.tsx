import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { mockActiveTrip, tripCompletedLabels } from '../../data/mockData';
import { JourneyRecap } from '../../components/organisms/JourneyRecap';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { TripController } from '../../services/trip/TripController';
import type { HomeScreenProps } from '../../types/navigation';

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
  const trip = TripController.getInstance().getTrip() ?? mockActiveTrip;

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
            <Icon name="verified" style={styles.checkIconText} />
          </View>
          <Text style={styles.title}>{tripCompletedLabels.title}</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{trip.currency}{trip.estimatedEarning}</Text>
            <Text style={styles.statLabel}>{tripCompletedLabels.earningsLabel}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{trip.totalDistanceKm} km</Text>
            <Text style={styles.statLabel}>{tripCompletedLabels.distanceLabel}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{trip.stops.length}</Text>
            <Text style={styles.statLabel}>{tripCompletedLabels.stopsLabel}</Text>
          </View>
        </View>

        {/* Journey Recap */}
        <View style={styles.recapSection}>
          <Text style={styles.recapTitle}>{tripCompletedLabels.journeyRecapTitle}</Text>
          <JourneyRecap
            stops={trip.stops}
          />
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
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkIconText: {
    fontSize: 40,
    color: '#2e7d32',
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
