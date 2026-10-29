import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../../types/navigation';
import { UnifiedAuthScreen } from '../../screens/auth/UnifiedAuthScreen';
import { OTPVerificationScreen } from '../../screens/auth/OTPVerificationScreen';
import { useAuth } from '../../hooks/useAuth';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export interface AuthStackProps {
  readonly initialRouteName?: keyof AuthStackParamList;
}

export const AuthStack: React.FC<AuthStackProps> = ({ initialRouteName }) => {
  const { sendOtp, verifyOtp, loginWithEmail, signUpWithEmail, resendOtp, isLoading, error } = useAuth();

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
    </Stack.Navigator>
  );
};

export default AuthStack;
