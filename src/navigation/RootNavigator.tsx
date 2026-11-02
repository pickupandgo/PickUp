import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getAuth } from '@react-native-firebase/auth';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../types/navigation';
import { AuthStack } from './stacks/AuthStack';
import { MainTabNavigator } from './MainTabNavigator';
import {
  AuthService,
  type DriverAccount,
  type DriverOnboardingSummary,
} from '../services/auth/AuthService';
import { DriverOnboardingScreen } from '../screens/onboarding/DriverOnboardingFlow';
import { NotificationsScreen } from '../screens/notifications/NotificationsScreen';
import { ActiveTripChatScreen } from '../screens/trip/ActiveTripChatScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC<{
  onReadyChange?: (ready: boolean) => void;
}> = ({ onReadyChange }) => {
  const [initializing, setInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [account, setAccount] = useState<DriverAccount | null>(null);
  const [onboarding, setOnboarding] = useState<DriverOnboardingSummary | null>(
    null,
  );
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    onReadyChange?.(!initializing);
  }, [initializing, onReadyChange]);

  const bootstrap = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    const uid = getAuth().currentUser?.uid;
    const current = () =>
      mounted.current &&
      generation.current === request &&
      getAuth().currentUser?.uid === uid;
    setInitializing(true);
    setBootstrapError(null);
    setIsAuthenticated(false);
    setAccount(null);
    setOnboarding(null);
    if (!uid) {
      setInitializing(false);
      return;
    }
    try {
      const driverAccount = await AuthService.getInstance().bootstrapDriver();
      if (!current()) return;
      const onboardingState = await AuthService.getInstance().getOnboarding();
      if (!current()) return;
      setAccount(driverAccount);
      setOnboarding(onboardingState);
      setIsAuthenticated(true);
    } catch (error) {
      if (!current()) return;
      setAccount(null);
      setIsAuthenticated(false);
      setBootstrapError(
        error instanceof Error
          ? error.message
          : 'Could not verify your driver account.',
      );
    } finally {
      if (current()) setInitializing(false);
    }
  }, []);

  const refreshOnboarding = useCallback(async () => {
    const request = generation.current;
    const uid = getAuth().currentUser?.uid;
    const state = await AuthService.getInstance().getOnboarding();
    if (
      !mounted.current ||
      generation.current !== request ||
      !uid ||
      getAuth().currentUser?.uid !== uid
    )
      return;
    setOnboarding(state);
    setAccount(current =>
      current ? { ...current, approvalStatus: state.approvalStatus } : current,
    );
  }, []);

  useEffect(() => {
    const authGeneration = generation;
    const authMounted = mounted;
    mounted.current = true;
    const authService = AuthService.getInstance();

    // observeAuthState handles Firebase auth state changes
    if (authService.observeAuthState) {
      const unsubscribe = authService.observeAuthState(async user => {
        if (!mounted.current) return;
        if (user) {
          // Token restoration may finish after signout or a different sign-in.
          if (getAuth().currentUser?.uid !== user.uid) return;
          await bootstrap();
        } else {
          ++generation.current;
          setIsAuthenticated(false);
          setAccount(null);
          setOnboarding(null);
          setBootstrapError(null);
          setInitializing(false);
        }
      });
      return () => {
        authMounted.current = false;
        ++authGeneration.current;
        unsubscribe();
      };
    } else {
      // Missing authentication infrastructure must never open protected routes.
      setBootstrapError(
        'Firebase authentication is unavailable. Please restart the app.',
      );
      setInitializing(false);
      return () => {
        authMounted.current = false;
        ++authGeneration.current;
      };
    }
  }, [bootstrap]);

  const renderAuthStack = useCallback(
    () => <AuthStack initialRouteName="UnifiedAuth" />,
    [],
  );

  if (initializing) {
    return null; // Don't render until Firebase auth state is determined
  }

  if (bootstrapError) {
    return (
      <AccountState
        title="We could not verify your account"
        message={bootstrapError}
        primaryLabel="Try again"
        onPrimary={() => void bootstrap()}
        secondaryLabel="Sign out"
        onSecondary={() => void AuthService.getInstance().logout()}
      />
    );
  }

  if (
    isAuthenticated &&
    account &&
    (onboarding?.eligible !== true || account.approvalStatus !== 'APPROVED')
  ) {
    if (!onboarding) {
      return (
        <AccountState
          title="Account review"
          message="Could not load your onboarding state."
          primaryLabel="Try again"
          onPrimary={() => void bootstrap()}
          secondaryLabel="Sign out"
          onSecondary={() => void AuthService.getInstance().logout()}
        />
      );
    }
    return (
      <DriverOnboardingScreen
        summary={onboarding}
        onRefresh={refreshOnboarding}
        onSignOut={() => AuthService.getInstance().logout()}
      />
    );
  }

  return (
    <Stack.Navigator
      key={isAuthenticated ? 'driver' : 'guest'}
      screenOptions={{ headerShown: false }}
    >
      {isAuthenticated &&
      account &&
      onboarding?.eligible === true &&
      account.approvalStatus === 'APPROVED' ? (
        <>
          <Stack.Screen name="Main" component={MainTabNavigator} />
          <Stack.Screen name="TripChat" component={ActiveTripChatScreen} />
          <Stack.Screen
            name="Notifications"
            component={NotificationsScreen}
            getId={() => 'partner-notifications'}
          />
        </>
      ) : (
        <Stack.Screen name="Auth" children={renderAuthStack} />
      )}
    </Stack.Navigator>
  );
};

const AccountState: React.FC<{
  title: string;
  message: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}> = ({
  title,
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}) => (
  <View style={styles.container}>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.message}>{message}</Text>
    {primaryLabel && onPrimary ? (
      <Pressable style={styles.primary} onPress={onPrimary}>
        <Text style={styles.primaryText}>{primaryLabel}</Text>
      </Pressable>
    ) : null}
    {secondaryLabel && onSecondary ? (
      <Pressable style={styles.secondary} onPress={onSecondary}>
        <Text style={styles.secondaryText}>{secondaryLabel}</Text>
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#FFFFFF',
  },
  title: {
    color: '#171C32',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    color: '#5B5E71',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    textAlign: 'center',
  },
  primary: {
    alignItems: 'center',
    backgroundColor: '#1A73E8',
    borderRadius: 8,
    marginTop: 28,
    minWidth: 180,
    padding: 14,
  },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  secondary: { marginTop: 12, padding: 12 },
  secondaryText: { color: '#1A73E8', fontWeight: '600' },
});

export default RootNavigator;
