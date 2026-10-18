import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { deliveryProofLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { InlineErrorBanner } from '../../components/molecules/InlineErrorBanner';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { useLiveTrip } from '../../hooks/useActiveTrip';
import { useI18n } from '../../i18n';
import { TripController } from '../../services/trip/TripController';
import {
  describeTripError,
  engineStatusOf,
} from '../../services/trip/tripErrors';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * DeliveryProofPreviewScreen
 * Preview the delivery photo, then confirm the delivery with the engine (backend first: an
 * unpaid drop is never delivered). A failure stays on this drop, shows why and re-reads the
 * trip; it is never shown as a success. The last delivery never completes the trip by itself:
 * the driver completes it explicitly.
 */
export interface DeliveryProofPreviewScreenProps {
  readonly navigation: HomeScreenProps<'DeliveryProofPreview'>['navigation'];
  readonly route: HomeScreenProps<'DeliveryProofPreview'>['route'];
  readonly testID?: string;
}

export const DeliveryProofPreviewScreen: React.FC<
  DeliveryProofPreviewScreenProps
> = ({ navigation, route, testID }) => {
  const { tripId, stopId, photoUri } = route.params;
  const { t } = useI18n();
  const trip = useLiveTrip(tripId);
  const [busy, setBusy] = useState<'deliver' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completionPending, setCompletionPending] = useState(false);

  // Delivered according to the engine (this request, or found so after a timeout and a re-read).
  const stop = trip?.stops.find(s => s.id === stopId);
  const delivered = stop?.engineStatus === 'DELIVERED';
  const allDone = trip ? engineStatusOf(trip) === 'DELIVERED' : false;

  const handleConfirm = useCallback(async () => {
    setBusy('deliver');
    setError(null);
    try {
      await TripController.getInstance().confirmDropDelivery(
        tripId,
        stopId,
        photoUri,
      );
    } catch (e) {
      setError(describeTripError(e, t));
    } finally {
      setBusy(null);
    }
  }, [tripId, stopId, photoUri, t]);

  const handleComplete = useCallback(async () => {
    setBusy('complete');
    setError(null);
    try {
      const result = await TripController.getInstance().completeTrip(tripId);
      if (result.completion === 'PENDING') {
        setCompletionPending(true);
      } else {
        navigation.navigate('TripCompleted', { tripId });
      }
    } catch (e) {
      setError(describeTripError(e, t));
    } finally {
      setBusy(null);
    }
  }, [tripId, navigation, t]);

  const handleRetake = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  if (delivered) {
    return (
      <SafeAreaView style={styles.safeArea} testID={testID}>
        <View style={styles.feedbackContainer}>
          <View style={styles.successIcon}>
            <Icon name="cloud_done" style={styles.successIconText} />
          </View>
          <Text style={styles.feedbackTitle}>{t('trip.delivered')}</Text>
          <Text style={styles.feedbackSubtitle}>
            {allDone
              ? t('trip.allDropsDone')
              : deliveryProofLabels.uploadSuccessSubtitle}
          </Text>
          {error ? <InlineErrorBanner message={error} /> : null}
          {completionPending ? (
            <Text style={styles.feedbackSubtitle}>
              {t('trip.completionPending')}
            </Text>
          ) : null}
          <View style={styles.feedbackActions}>
            {allDone ? (
              <>
                <PrimaryButton
                  label={t('trip.completeTrip')}
                  onPress={handleComplete}
                  loading={busy === 'complete'}
                  disabled={busy !== null}
                />
                <SecondaryButton
                  label={t('trip.backToDrop')}
                  onPress={() =>
                    navigation.navigate('DropOTP', { tripId, stopId })
                  }
                  disabled={busy !== null}
                />
              </>
            ) : (
              <PrimaryButton
                label={t('trip.nextDrop')}
                onPress={() => navigation.navigate('ActiveTrip', { tripId })}
              />
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={deliveryProofLabels.cameraTitle}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <View style={styles.container}>
        {/* Photo preview */}
        <View style={styles.previewContainer}>
          {photoUri && photoUri.startsWith('mock://') ? (
            <View style={styles.previewPlaceholder}>
              <Icon name="image" style={styles.previewIcon} />
              <Text style={styles.previewText}>Photo Preview</Text>
            </View>
          ) : (
            <Image
              source={{ uri: photoUri }}
              style={styles.previewImage}
              resizeMode="cover"
            />
          )}
        </View>

        {error ? (
          <View style={styles.errorBlock}>
            <InlineErrorBanner message={error} />
            <Text style={styles.feedbackSubtitle}>
              {t('trip.deliveryNotConfirmed')}
            </Text>
          </View>
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          <PrimaryButton
            label={
              error ? t('trip.tryAgain') : deliveryProofLabels.confirmLabel
            }
            onPress={handleConfirm}
            loading={busy === 'deliver'}
            disabled={busy !== null || !trip}
          />
          {error ? (
            <SecondaryButton
              label={t('trip.backToDrop')}
              onPress={() => navigation.navigate('DropOTP', { tripId, stopId })}
              disabled={busy !== null}
            />
          ) : (
            <SecondaryButton
              label={deliveryProofLabels.retakeLabel}
              onPress={handleRetake}
              disabled={busy !== null}
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    paddingHorizontal: spacing.containerPadding,
    justifyContent: 'space-between',
  },
  previewContainer: {
    flex: 1,
    paddingVertical: spacing.containerPadding,
  },
  previewPlaceholder: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  previewImage: {
    flex: 1,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainerLow,
  },
  previewIcon: {
    fontSize: 64,
    color: colors.outline,
  },
  previewText: {
    ...typography.headlineSm,
    color: colors.onSurfaceVariant,
  },
  errorBlock: {
    gap: spacing.xs,
    marginBottom: spacing.gutter,
  },
  actions: {
    gap: spacing.gutter,
    paddingBottom: spacing.lg,
  },
  feedbackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.containerPadding,
    paddingHorizontal: spacing.lg,
  },
  feedbackActions: {
    alignSelf: 'stretch',
    gap: spacing.gutter,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e8f5e9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successIconText: {
    fontSize: 40,
    color: '#2e7d32',
  },
  feedbackTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  feedbackSubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
});

export default DeliveryProofPreviewScreen;
