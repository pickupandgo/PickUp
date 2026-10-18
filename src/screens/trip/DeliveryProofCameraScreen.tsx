import React, { useCallback } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { env } from '../../config/env';
import { deliveryProofLabels } from '../../data/mockData';
import { useI18n } from '../../i18n';
import { CameraOverlay } from '../../components/organisms/CameraOverlay';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * DeliveryProofCameraScreen
 * Camera UI for capturing delivery proof photo.
 * Uses CameraOverlay organism. Actual camera integration is platform-specific
 * and will be added later. This screen provides the UI shell.
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

  const handleCapture = useCallback(async () => {
    // Mock mode only (no trip engine): a placeholder photo for the local demo trip.
    const placeholder = env.IS_MOCK_MODE
      ? 'mock://delivery-proof-photo.jpg'
      : null;
    let uri: string | null = null;
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
      uri = result.assets?.[0]?.uri ?? placeholder;
    } catch {
      uri = placeholder;
    }
    if (!uri) {
      // A delivery is never confirmed without a real photo.
      Alert.alert(deliveryProofLabels.cameraTitle, t('trip.cameraFailed'));
      return;
    }
    navigation.navigate('DeliveryProofPreview', {
      tripId,
      stopId,
      photoUri: uri,
    });
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
