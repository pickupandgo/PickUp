import React from 'react';
import UnavailableFeature from '../../components/organisms/UnavailableFeature';
export interface DriverRatingScreenProps {
  readonly onClose?: () => void;
  readonly onSubmit?: (rating: number, feedback: string[]) => void;
  readonly onSkip?: () => void;
}
export default function DriverRatingScreen({
  onClose,
  navigation,
}: DriverRatingScreenProps & { navigation?: any; route?: any }) {
  return (
    <UnavailableFeature
      title="Driver ratings unavailable"
      message="Ratings are not available yet. No rating or feedback has been submitted."
      onBack={() => (onClose ? onClose() : navigation?.goBack())}
    />
  );
}
