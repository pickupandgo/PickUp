import React from 'react';
import { FloatingWindowScreen } from '../../screens/account/FloatingWindowScreen';
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
import { EditProfileScreen } from '../../screens/account/EditProfileScreen';
import { PrivacyScreen } from '../../screens/account/PrivacyScreen';
import { LegalInformationScreen } from '../../screens/account/LegalInformationScreen';
import { DataPermissionsScreen } from '../../screens/account/DataPermissionsScreen';
import { HelpSupportScreen } from '../../screens/account/HelpSupportScreen';
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
      <Stack.Screen name="FloatingWindow" component={FloatingWindowScreen} />
      <Stack.Screen name="EditProfile" component={EditProfileScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
      <Stack.Screen name="LegalInformation" component={LegalInformationScreen} />
      <Stack.Screen name="DataPermissions" component={DataPermissionsScreen} />
      <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
      <Stack.Screen name="DocumentsHub" component={DocumentsHubScreen} />
      <Stack.Screen name="PersonalDocuments" component={PersonalDocumentsScreen} />
      <Stack.Screen name="KYCStatus" component={KYCStatusScreen} />
      <Stack.Screen name="VehicleDocuments" component={VehicleDocumentsScreen} />
      <Stack.Screen name="DocumentPreview" component={DocumentPreviewScreen} options={{ presentation: 'fullScreenModal' }} />
      <Stack.Screen name="VehicleStatus" component={VehicleStatusScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="LanguageSelection" component={SettingsLanguageScreen} />
      <Stack.Screen name="AccountRestricted" component={AccountRestrictedScreen} />
    </Stack.Navigator>
  );
};

export default AccountStack;
