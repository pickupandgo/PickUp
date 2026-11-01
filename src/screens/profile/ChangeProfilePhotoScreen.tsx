import React from 'react';
import UnavailableFeature from '../../components/organisms/UnavailableFeature';
export interface ChangeProfilePhotoScreenProps {
  readonly onClose?: () => void;
}
export default function ChangeProfilePhotoScreen({
  onClose,
  navigation,
}: ChangeProfilePhotoScreenProps & { navigation?: any; route?: any }) {
  return (
    <UnavailableFeature
      title="Profile photo"
      message="Profile photo changes are not available yet. Your photo has not been changed."
      onBack={() => (onClose ? onClose() : navigation?.goBack())}
    />
  );
}
