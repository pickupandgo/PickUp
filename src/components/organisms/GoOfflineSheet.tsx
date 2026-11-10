import React from 'react';
import type { ViewStyle } from 'react-native';
import { AvailabilitySheet } from './AvailabilitySheet';

export interface GoOfflineSheetProps {
  readonly onGoOffline: () => void;
  readonly onStayLive: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const GoOfflineSheet: React.FC<GoOfflineSheetProps> = ({ onGoOffline, onStayLive, style, testID }) => (
  <AvailabilitySheet online={false} onConfirm={onGoOffline} onDismiss={onStayLive} style={style} testID={testID} />
);

export default GoOfflineSheet;
