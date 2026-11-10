import React from 'react';
import type { ViewStyle } from 'react-native';
import { AvailabilitySheet } from './AvailabilitySheet';

export interface GoLiveSheetProps {
  readonly onContinue: () => void;
  readonly onCancel: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const GoLiveSheet: React.FC<GoLiveSheetProps> = ({ onContinue, onCancel, style, testID }) => (
  <AvailabilitySheet online={true} onConfirm={onContinue} onDismiss={onCancel} style={style} testID={testID} />
);

export default GoLiveSheet;
