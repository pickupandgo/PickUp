import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { launchCamera } from 'react-native-image-picker';
import { deliveryProofLabels } from '../../data/mockData';
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

export const DeliveryProofCameraScreen: React.FC<DeliveryProofCameraScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { tripId, stopId } = route.params;

  const handleCapture = useCallback(async () => {
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
      navigation.navigate('DeliveryProofPreview', {
        tripId,
        stopId,
        photoUri: uri ?? 'mock://delivery-proof-photo.jpg',
      });
    } catch (e) {
      // If the camera can't be opened, don't block the flow.
      navigation.navigate('DeliveryProofPreview', {
        tripId,
        stopId,
        photoUri: 'mock://delivery-proof-photo.jpg',
      });
    }
  }, [navigation, tripId, stopId]);

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
