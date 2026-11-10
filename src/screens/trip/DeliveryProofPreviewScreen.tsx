import React, { useState, useCallback, useRef, useEffect } from 'react';
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
import { uploadDeliveryProof, type ProofUpload, type ProofPhase } from '../../services/trip/DeliveryProofService';
import { getCurrentDriverId } from '../../services/engine/dispatch';
import { env } from '../../config/env';
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
  const { tripId, stopId, photoUri, photoType } = route.params;
  const { t } = useI18n();
  const trip = useLiveTrip(tripId);
  const [busy, setBusy] = useState<'deliver' | 'complete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [completionPending, setCompletionPending] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<ProofPhase | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const proof = useRef<ProofUpload | undefined>(undefined);
  const locked = useRef<string | null>(null);
  const mounted = useRef(true);
  const scope = `${tripId}:${stopId}:${photoUri}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    proof.current = undefined; locked.current = null;
    setPhotoFailed(false); setBusy(null); setError(null); setUploadPhase(null); setCompletionPending(false);
  }, [tripId, stopId, photoUri]);

  // Delivered according to the engine (this request, or found so after a timeout and a re-read).
  const stop = trip?.stops.find(s => s.id === stopId);
  const delivered = stop?.engineStatus === 'DELIVERED';
  const allDone = trip ? engineStatusOf(trip) === 'DELIVERED' : false;

  const handleConfirm = useCallback(async () => {
    if (locked.current || photoFailed) return;
    locked.current = scope;
    const uid = getCurrentDriverId();
    const current = () => mounted.current && currentScope.current === scope && getCurrentDriverId() === uid;
    setBusy('deliver');
    setError(null);
    try {
      const reference = env.IS_MOCK_MODE ? photoUri : await uploadDeliveryProof({
        tripId, stopId, uri: photoUri, contentType: photoType, previous: proof.current,
        isCurrent: current,
        onPrepared: value => { if (current()) proof.current = value; },
        onPhase: value => { if (current()) setUploadPhase(value); },
      });
      if (!current()) return;
      setUploadPhase(null);
      await TripController.getInstance().confirmDropDelivery(
        tripId,
        stopId,
        reference,
      );
    } catch (e) {
      if (current()) setError(e instanceof Error && !(e as { code?: string }).code ? e.message : describeTripError(e, t));
    } finally {
      if (locked.current === scope) locked.current = null;
      if (current()) { setBusy(null); setUploadPhase(null); }
    }
  }, [tripId, stopId, photoUri, photoType, photoFailed, scope, t]);

  const handleComplete = useCallback(async () => {
    setBusy('complete');
    setError(null);
    try {
      const result = await TripController.getInstance().completeTrip(tripId);
      if (result.completion === 'PENDING' || result.trip.engineStatus !== 'COMPLETED') {
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
              : 'Delivery confirmed by the backend. Continue to the next drop.'}
          </Text>
          <Text style={styles.feedbackSubtitle}>A photo reference was submitted. Secure photo storage is not verified.</Text>
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
              key={photoUri}
              source={{ uri: photoUri }}
              style={styles.previewImage}
              resizeMode="cover"
              onError={() => { setPhotoFailed(true); setError('This photo is no longer available. Retake it before confirming.'); }}
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
              uploadPhase === 'preparing' ? 'Preparing photo…' : uploadPhase === 'uploading' ? 'Uploading photo…' : uploadPhase === 'verifying' ? 'Verifying photo…' : error ? t('trip.tryAgain') : deliveryProofLabels.confirmLabel
            }
            onPress={handleConfirm}
            loading={busy === 'deliver'}
            disabled={busy !== null || !trip || photoFailed}
          />
          {error ? (
            <>
            <SecondaryButton label={deliveryProofLabels.retakeLabel} onPress={handleRetake} disabled={busy !== null} />
            <SecondaryButton
              label={t('trip.backToDrop')}
              onPress={() => navigation.navigate('DropOTP', { tripId, stopId })}
              disabled={busy !== null}
            />
            </>
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
