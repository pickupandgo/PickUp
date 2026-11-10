import React from 'react';
import { SubscriptionUnavailable } from '../../components/account/SubscriptionUnavailable';
import type { AccountScreenProps } from '../../types/navigation';
export interface SubscriptionScreenProps {
  readonly navigation: AccountScreenProps<'Subscription'>['navigation'];
  readonly testID?: string;
}
export const SubscriptionScreen: React.FC<SubscriptionScreenProps> = ({
  navigation,
  testID,
}) => (
  <SubscriptionUnavailable
    onBack={() => navigation.popToTop()}
    testID={testID}
  />
);
export default SubscriptionScreen;
