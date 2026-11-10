import React, { useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { env } from '../../config/env';
import { getCurrentDriverId } from '../../services/engine/dispatch';
import { deliveryProofLabels } from '../../data/mockData';
import { useI18n } from '../../i18n';
import { CameraOverlay } from '../../components/organisms/CameraOverlay';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * DeliveryProofCameraScreen
 * Camera UI for capturing delivery proof photo.
 * Captures a local photo for preview. Upload and server verification happen before delivery.
 */
export interface DeliveryProofCameraScreenProps {
  readonly navigation: HomeScreenProps<'DeliveryProofCamera'>['navigation'];
  readonly route: HomeScreenProps<'DeliveryProofCamera'>['route'];
  readonly testID?: string;
}

export const DeliveryProofCameraScreen: React.FC<
  DeliveryProofCameraScreenProps
> = ({ navigation, route, testID }) => {
  const { tripId, stopId } = route.params;
  const { t } = useI18n();
  const capturing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const handleCapture = useCallback(async () => {
    if (capturing.current) return;
    capturing.current = true;
    const uid = getCurrentDriverId();
    try {
    // Mock mode only (no trip engine): a placeholder photo for the local demo trip.
    const placeholder = env.IS_MOCK_MODE
      ? 'mock://delivery-proof-photo.jpg'
      : null;
    let uri: string | null = null;
    let photoType: string | undefined;
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        quality: 0.7,
        saveToPhotos: false,
        cameraType: 'back',
        maxWidth: 1920,
        maxHeight: 1920,
      });

      if (result.didCancel) {
        return; // Driver backed out of the camera; stay on this screen.
      }
      uri = result.assets?.[0]?.uri ?? placeholder;
      photoType = result.assets?.[0]?.type;
    } catch {
      uri = placeholder;
    }
    if (!mounted.current || navigation.isFocused?.() === false || (!env.IS_MOCK_MODE && (!uid || getCurrentDriverId() !== uid))) return;
    if (!uri) {
      // A delivery is never confirmed without a real photo.
      Alert.alert(deliveryProofLabels.cameraTitle, t('trip.cameraFailed'));
      return;
    }
    navigation.navigate('DeliveryProofPreview', {
      tripId,
      stopId,
      photoUri: uri,
      photoType,
    });
    } finally { capturing.current = false; }
  }, [navigation, tripId, stopId, t]);

  return (
    <View style={styles.container} testID={testID}>
      <CameraOverlay
        title={deliveryProofLabels.cameraTitle}
        instructions={deliveryProofLabels.cameraInstructions}
        onCapture={handleCapture}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});

export default DeliveryProofCameraScreen;
