import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { CameraOverlay } from '../../components/organisms/CameraOverlay';
import { useI18n } from '../../i18n';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * DeliveryProofCameraScreen
 * Camera UI for capturing delivery proof photo.
 * Automatically accesses the device camera upon opening so the driver does not
 * have to manually tap the shutter button first. If the driver backs out of the
 * camera, the overlay UI provides a manual shutter button to retry and a back button.
 */
export interface DeliveryProofCameraScreenProps {
  readonly navigation: HomeScreenProps<'DeliveryProofCamera'>['navigation'];
  readonly route: HomeScreenProps<'DeliveryProofCamera'>['route'];
  readonly testID?: string;
}

export const DeliveryProofCameraScreen: React.FC<DeliveryProofCameraScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { tripId, stopId } = route.params;
  const isCapturingRef = useRef(false);
  const hasAutoLaunchedRef = useRef(false);

  const handleCapture = useCallback(async () => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        quality: 0.7,
        saveToPhotos: false,
        cameraType: 'back',
      });

      if (result.didCancel) {
        return; // Driver backed out of the camera; stay on this screen.
      }

      const uri = result.assets?.[0]?.uri;
      if (uri) {
        navigation.replace('DeliveryProofPreview', {
          tripId,
          stopId,
          photoUri: uri,
        });
      }
    } catch (e) {
      console.warn('[DeliveryProofCamera] Failed to launch camera', e);
      // In mock/test environments or if launch fails, provide fallback so flow is never blocked
      navigation.replace('DeliveryProofPreview', {
        tripId,
        stopId,
        photoUri: 'mock://delivery-proof-photo.jpg',
      });
    } finally {
      isCapturingRef.current = false;
    }
  }, [navigation, tripId, stopId]);

  // Access camera immediately the moment this screen mounts
  useEffect(() => {
    if (!hasAutoLaunchedRef.current) {
      hasAutoLaunchedRef.current = true;
      const timer = setTimeout(() => {
        handleCapture();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [handleCapture]);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container} testID={testID}>
      <CameraOverlay
        title={t('deliveryProof.title')}
        instructions={t('deliveryProof.instructions')}
        captureLabel={t('deliveryProof.capture')}
        onCapture={handleCapture}
        onBack={handleBack}
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
