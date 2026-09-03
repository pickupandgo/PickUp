import React, { useState, useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types/navigation';
import { AuthStack } from './stacks/AuthStack';
import { MainTabNavigator } from './MainTabNavigator';
import { AuthService } from '../services/auth/AuthService';
import { isOnboardingComplete, markOnboardingComplete, clearOnboardingComplete } from '../state/onboarding';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const [initializing, setInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    const authService = AuthService.getInstance();
    
    // observeAuthState handles Firebase auth state changes
    if (authService.observeAuthState) {
      const unsubscribe = authService.observeAuthState(async (user) => {
        if (user) {
          setIsAuthenticated(true);

          // Prefer the persisted onboarding flag so a logged-in, onboarded
          // driver lands on Home across restarts. Fall back to the profile's
          // completion percent (and persist it if complete).
          let complete = await isOnboardingComplete();
          if (!complete) {
            try {
              const profile = await authService.getProfile();
              complete = profile.profileCompletionPercent === 100;
            } catch {
              complete = false;
            }
            if (complete) {
              await markOnboardingComplete();
            }
          }
          setOnboardingComplete(complete);
        } else {
          // Signed out: clear the flag so a future login re-runs onboarding.
          setIsAuthenticated(false);
          setOnboardingComplete(false);
          await clearOnboardingComplete();
        }

        if (initializing) {
          setInitializing(false);
        }
      });
      return unsubscribe;
    } else {
      // Mock mode without observeAuthState
      setInitializing(false);
      return () => {};
    }
  }, [initializing]);

  if (initializing) {
    return null; // Don't render until Firebase auth state is determined
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <Stack.Screen name="Auth">
          {() => {
            console.log(`[OTP DEBUG] rendering Auth stack (unauthenticated)`);
            return (
              <AuthStack 
                initialRouteName="UnifiedAuth"
                onAuthComplete={() => {
                  void markOnboardingComplete();
                  setOnboardingComplete(true);
                }} 
              />
            );
          }}
        </Stack.Screen>
      ) : onboardingComplete ? (
        <Stack.Screen name="Main" component={MainTabNavigator} />
      ) : (
        <Stack.Screen name="Onboarding">
          {() => {
            console.log(`[OTP DEBUG] rendering Onboarding stack (initialRouteName=LanguageSelection)`);
            return (
              <AuthStack 
                initialRouteName="LanguageSelection"
                onAuthComplete={() => {
                  void markOnboardingComplete();
                  setOnboardingComplete(true);
                }} 
              />
            );
          }}
        </Stack.Screen>
      )}
    </Stack.Navigator>
  );
};

export default RootNavigator;
