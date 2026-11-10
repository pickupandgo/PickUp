import React from 'react';
import { SubscriptionUnavailable } from '../../components/account/SubscriptionUnavailable';
import type { AccountScreenProps } from '../../types/navigation';
export interface SubscriptionResultScreenProps {
  readonly navigation: AccountScreenProps<'SubscriptionResult'>['navigation'];
  readonly route: AccountScreenProps<'SubscriptionResult'>['route'];
  readonly testID?: string;
}
export const SubscriptionResultScreen: React.FC<
  SubscriptionResultScreenProps
> = ({ navigation, testID }) => (
  <SubscriptionUnavailable
    onBack={() => navigation.popToTop()}
    testID={testID}
  />
);
export default SubscriptionResultScreen;
