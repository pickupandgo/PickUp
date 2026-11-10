import React from 'react';
import { SubscriptionUnavailable } from '../../components/account/SubscriptionUnavailable';
import type { AccountScreenProps } from '../../types/navigation';
export interface SubscriptionProcessingScreenProps {
  readonly navigation: AccountScreenProps<'SubscriptionProcessing'>['navigation'];
  readonly testID?: string;
}
export const SubscriptionProcessingScreen: React.FC<
  SubscriptionProcessingScreenProps
> = ({ navigation, testID }) => (
  <SubscriptionUnavailable
    onBack={() => navigation.popToTop()}
    testID={testID}
  />
);
export default SubscriptionProcessingScreen;
