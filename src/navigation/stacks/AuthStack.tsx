import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types/navigation';
import { UnifiedAuthScreen } from '../../screens/auth/UnifiedAuthScreen';
import { DriverRegistrationScreen } from '../../screens/auth/DriverRegistrationScreen';
import { OTPVerificationScreen } from '../../screens/auth/OTPVerificationScreen';
import { VehicleSelectionScreen } from '../../screens/auth/VehicleSelectionScreen';
import { LanguageSelectionScreen } from '../../screens/auth/LanguageSelectionScreen';
import { PendingVerificationScreen } from '../../screens/auth/PendingVerificationScreen';
import { useAuth } from '../../hooks/useAuth';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export interface AuthStackProps {
  readonly onAuthComplete: () => void;
  readonly initialRouteName?: keyof AuthStackParamList;
}

export const AuthStack: React.FC<AuthStackProps> = ({ onAuthComplete, initialRouteName }) => {
  const { sendOtp, verifyOtp, loginWithEmail, signUpWithEmail, resendOtp, completeOnboarding, isLoading, error } = useAuth();

  return (
    <Stack.Navigator
      initialRouteName={initialRouteName || 'UnifiedAuth'}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="UnifiedAuth">
        {({ navigation }) => (
          <UnifiedAuthScreen
            navigation={navigation}
            onSendOtp={sendOtp}
            onLoginWithEmail={loginWithEmail}
            onSignUpWithEmail={signUpWithEmail}
            isLoading={isLoading}
            error={error}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="DriverRegistration">
        {({ navigation, route }) => (
          <DriverRegistrationScreen navigation={navigation} route={route} />
        )}
      </Stack.Screen>
      <Stack.Screen name="OTPVerification">
        {({ navigation, route }) => (
          <OTPVerificationScreen
            navigation={navigation}
            route={route}
            onVerifyOtp={verifyOtp}
            onResendOtp={() => resendOtp(route.params.phone)}
            isLoading={isLoading}
            error={error}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="LanguageSelection">
        {({ navigation }) => (
          <LanguageSelectionScreen
            navigation={navigation}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="VehicleSelection">
        {({ navigation, route }) => (
          <VehicleSelectionScreen
            navigation={navigation}
            route={route}
            onComplete={(vehicleId, language) => {
              completeOnboarding(vehicleId, language);
              onAuthComplete();
            }}
          />
        )}
      </Stack.Screen>
      <Stack.Screen name="PendingVerification">
        {({ navigation, route }) => (
          <PendingVerificationScreen
            navigation={navigation}
            route={route}
          />
        )}
      </Stack.Screen>
    </Stack.Navigator>
  );
};

export default AuthStack;
