import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppState, type AppStateStatus, View, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types/navigation';
import { AuthStack } from './stacks/AuthStack';
import { MainTabNavigator } from './MainTabNavigator';
import { AuthService } from '../services/auth/AuthService';
import { isOnboardingComplete, markOnboardingComplete, clearOnboardingComplete } from '../state/onboarding';
import { colors, spacing } from '../theme';
import { perfMetrics } from '../utils/perfMetrics';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const [initializing, setInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [driverApprovalStatus, setDriverApprovalStatus] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const authService = AuthService.getInstance();

    // 1. Listen to dynamic profile changes (e.g. from registration, refresh, or manual poll)
    const unsubProfile = AuthService.observeProfileState((profile) => {
      if (!profile) {
        if (currentUserIdRef.current) {
          setDriverApprovalStatus('UNPROVISIONED');
          setOnboardingComplete(false);
        }
        return;
      }
      const status = profile.approvalStatus || 'PENDING';
      setDriverApprovalStatus(status);
      if (status === 'APPROVED') {
        const uid = currentUserIdRef.current || 'driver';
        void markOnboardingComplete(uid);
        setOnboardingComplete(true);
      } else {
        setOnboardingComplete(false);
      }
    });

    // 2. Refresh profile whenever app comes into foreground (non-blocking)
    const appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active' && currentUserIdRef.current) {
        void authService.fetchDriverProfile().catch((err: any) => {
          console.warn('[NAV] Background resume profile refresh failed:', err?.message);
        });
      }
    });
    
    // 3. observeAuthState handles Firebase auth state changes
    if (authService.observeAuthState) {
      const unsubscribeAuth = authService.observeAuthState(async (user) => {
        if (user) {
          currentUserIdRef.current = user.uid;
          setIsAuthenticated(true);
          perfMetrics.measureSinceLaunch('FIREBASE_AUTH_USER_RESTORED');

          // Fast-path: Check for cached profile first so returning drivers don't wait on network
          const cached = await AuthService.loadCachedProfile(user.uid);
          if (cached && cached.approvalStatus) {
            perfMetrics.measureSinceLaunch('AUTH_PROFILE_CACHE_HIT', { status: cached.approvalStatus });
            const cachedStatus = cached.approvalStatus;
            setDriverApprovalStatus(cachedStatus);
            if (cachedStatus === 'APPROVED') {
              setOnboardingComplete(true);
            } else {
              setOnboardingComplete(false);
            }
            // Dismiss splash / spinner immediately
            setInitializing(false);
          }

          // Authoritative server validation (background if cached, blocking if cold first login)
          const validateWithServer = async () => {
            try {
              if (authService.fetchDriverProfile) {
                const backendProfile = await authService.fetchDriverProfile();
                perfMetrics.measureSinceLaunch('AUTH_PROFILE_SERVER_VALIDATED');
                if (!backendProfile) {
                  // Identity verified via Firebase but unprovisioned in backend database
                  setDriverApprovalStatus('UNPROVISIONED');
                  setOnboardingComplete(false);
                } else {
                  const status = backendProfile.approvalStatus || 'PENDING';
                  setDriverApprovalStatus(status);

                  if (status === 'APPROVED') {
                    let complete = await isOnboardingComplete(user.uid);
                    if (!complete) {
                      await markOnboardingComplete(user.uid);
                      complete = true;
                    }
                    setOnboardingComplete(complete);
                  } else {
                    setOnboardingComplete(false);
                  }
                }
              } else {
                // Mock fallback
                setDriverApprovalStatus('APPROVED');
                const complete = await isOnboardingComplete(user.uid);
                setOnboardingComplete(complete);
              }
            } catch (e: any) {
              const msg = e?.message || '';
              if (msg.includes('USER_NOT_PROVISIONED') || msg.includes('not registered') || e?.statusCode === 403) {
                setDriverApprovalStatus('UNPROVISIONED');
                setOnboardingComplete(false);
              } else {
                // Offline or network error: fall back to checking local onboarding flag if no cache
                if (!cached) {
                  const complete = await isOnboardingComplete(user.uid);
                  setOnboardingComplete(complete);
                }
              }
            } finally {
              setInitializing(false);
            }
          };

          if (cached && cached.approvalStatus) {
            // Revalidate with server asynchronously in the background
            void validateWithServer();
          } else {
            // No cache available; wait for authoritative server response
            await validateWithServer();
          }
        } else {
          // Signed out: reset navigation state without wiping saved onboarding progress
          currentUserIdRef.current = null;
          setIsAuthenticated(false);
          setOnboardingComplete(false);
          setDriverApprovalStatus(null);
          setInitializing(false);
        }
      });

      return () => {
        unsubProfile();
        appStateSubscription.remove();
        unsubscribeAuth();
      };
    } else {
      // Mock mode without observeAuthState
      setInitializing(false);
      return () => {
        unsubProfile();
        appStateSubscription.remove();
      };
    }
  }, []);

  const renderAuthStack = useCallback(() => (
    <AuthStack 
      initialRouteName="UnifiedAuth"
      onAuthComplete={() => {
        void markOnboardingComplete();
        setOnboardingComplete(true);
      }} 
    />
  ), []);

  const renderOnboardingStack = useCallback(() => (
    <AuthStack 
      initialRouteName="LanguageSelection"
      onAuthComplete={() => {
        void markOnboardingComplete();
        setOnboardingComplete(true);
      }} 
    />
  ), []);

  const renderPendingVerificationStack = useCallback(() => (
    <AuthStack
      initialRouteName="PendingVerification"
      onAuthComplete={() => {
        void markOnboardingComplete();
        setOnboardingComplete(true);
      }}
    />
  ), []);

  const renderRegistrationStack = useCallback(() => (
    <AuthStack
      initialRouteName="DriverRegistration"
      onAuthComplete={() => {
        void markOnboardingComplete();
        setOnboardingComplete(true);
      }}
    />
  ), []);

  if (initializing) {
    return (
      <View style={styles.splashContainer}>
        <Image
          source={require('../../assets/logo.png')}
          style={styles.splashLogo}
          resizeMode="contain"
        />
        <ActivityIndicator
          size="large"
          color={colors.primary}
          style={styles.splashSpinner}
        />
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <Stack.Screen name="Auth" children={renderAuthStack} />
      ) : driverApprovalStatus === 'UNPROVISIONED' ? (
        <Stack.Screen name="Onboarding" children={renderRegistrationStack} />
      ) : driverApprovalStatus && driverApprovalStatus !== 'APPROVED' ? (
        <Stack.Screen name="PendingVerification" children={renderPendingVerificationStack} />
      ) : onboardingComplete ? (
        <Stack.Screen name="Main" component={MainTabNavigator} />
      ) : (
        <Stack.Screen name="Onboarding" children={renderOnboardingStack} />
      )}
    </Stack.Navigator>
  );
};

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    width: 140,
    height: 140,
    marginBottom: spacing.lg,
  },
  splashSpinner: {
    marginTop: spacing.sm,
  },
});

export default RootNavigator;
