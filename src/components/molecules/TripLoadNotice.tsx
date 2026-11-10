import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useTripResource } from '../../hooks/useActiveTrip';
import { TripController } from '../../services/trip/TripController';
import { describeTripError } from '../../services/trip/tripErrors';
import { useI18n } from '../../i18n';
import { colors, spacing, typography } from '../../theme';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { SecondaryButton } from '../atoms/SecondaryButton';

/** A failed/empty read is not an endless spinner or permission to use another trip. */
export const TripLoadNotice: React.FC<{
  tripId?: string;
  onHome?: () => void;
  message?: string;
}> = ({ tripId, onHome, message }) => {
  const resource = useTripResource(tripId, false);
  const { t } = useI18n();
  const loading = resource.status === 'loading' || resource.status === 'idle';
  const retry = () => {
    const controller = TripController.getInstance();
    (tripId ? controller.loadTrip(tripId) : controller.loadInitialTrip()).catch(() => {});
  };
  return (
    <View style={styles.container} accessibilityLiveRegion="polite">
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      <Text style={styles.title}>{loading ? 'Checking your trip…' : resource.error ? 'Could not load your trip' : 'Trip unavailable'}</Text>
      {!loading ? <>
        <Text style={styles.message}>{resource.error ? describeTripError(resource.error, t) : message ?? 'This trip is no longer active. Return Home to check your current trip.'}</Text>
        <PrimaryButton label="Try again" onPress={retry} />
        {onHome ? <SecondaryButton label="Back to Home" onPress={onHome} /> : null}
      </> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.containerPadding, justifyContent: 'center', backgroundColor: colors.surface },
  title: { ...typography.headlineSm, color: colors.onSurface, textAlign: 'center' },
  message: { ...typography.bodyMd, color: colors.onSurfaceVariant, textAlign: 'center' },
});
