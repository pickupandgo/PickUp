import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AccountStackParamList } from '../../types/navigation';

import { ProfileScreen } from '../../screens/account/ProfileScreen';
import { PersonalDocumentsScreen } from '../../screens/account/PersonalDocumentsScreen';
import { DocumentsHubScreen } from '../../screens/account/DocumentsHubScreen';
import { KYCStatusScreen } from '../../screens/account/KYCStatusScreen';
import { VehicleDocumentsScreen } from '../../screens/account/VehicleDocumentsScreen';
import { DocumentPreviewScreen } from '../../screens/account/DocumentPreviewScreen';
import { VehicleStatusScreen } from '../../screens/account/VehicleStatusScreen';
import { SettingsScreen } from '../../screens/account/SettingsScreen';
import { SubscriptionScreen } from '../../screens/account/SubscriptionScreen';
import { SubscriptionProcessingScreen } from '../../screens/account/SubscriptionProcessingScreen';
import { SubscriptionResultScreen } from '../../screens/account/SubscriptionResultScreen';
import { SettingsLanguageScreen } from '../../screens/account/SettingsLanguageScreen';
import { AccountRestrictedScreen } from '../../screens/account/AccountRestrictedScreen';

const Stack = createNativeStackNavigator<AccountStackParamList>();

export const AccountStack: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="DocumentsHub" component={DocumentsHubScreen} />
      <Stack.Screen name="PersonalDocuments" component={PersonalDocumentsScreen} />
      <Stack.Screen name="KYCStatus" component={KYCStatusScreen} />
      <Stack.Screen name="VehicleDocuments" component={VehicleDocumentsScreen} />
      <Stack.Screen name="DocumentPreview" component={DocumentPreviewScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="VehicleStatus" component={VehicleStatusScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Subscription" component={SubscriptionScreen} />
      <Stack.Screen
        name="SubscriptionProcessing"
        component={SubscriptionProcessingScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen
        name="SubscriptionResult"
        component={SubscriptionResultScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen name="LanguageSelection" component={SettingsLanguageScreen} />
      <Stack.Screen name="AccountRestricted" component={AccountRestrictedScreen} />
    </Stack.Navigator>
  );
};

export default AccountStack;
