import React from 'react';
import UnavailableFeature from '../../components/organisms/UnavailableFeature';
export interface WrittenReviewScreenProps {
  readonly onBack?: () => void;
  readonly onSkip?: () => void;
  readonly onSubmit?: (text: string) => void;
  readonly onAddPhoto?: () => void;
  readonly onAddLocation?: () => void;
  // bottom nav props
  readonly currentTab?: string;
  readonly onTabPress?: (tabId: string) => void;
}
export default function WrittenReviewScreen({
  onBack,
  navigation,
}: WrittenReviewScreenProps & { navigation?: any; route?: any }) {
  return (
    <UnavailableFeature
      title="Reviews unavailable"
      message="Review submission is not available yet. No review has been sent. Your active booking has not been changed."
      onBack={() => (onBack ? onBack() : navigation?.goBack())}
    />
  );
}
