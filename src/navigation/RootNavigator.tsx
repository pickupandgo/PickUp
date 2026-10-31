import React, { useState, useEffect, useCallback } from 'react';
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

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  const [initializing, setInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [account, setAccount] = useState<DriverAccount | null>(null);
  const [onboarding, setOnboarding] = useState<DriverOnboardingSummary | null>(
    null,
  );
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const bootstrap = useCallback(async () => {
    setInitializing(true);
    setBootstrapError(null);
    try {
      const driverAccount = await AuthService.getInstance().bootstrapDriver();
      const onboardingState = await AuthService.getInstance().getOnboarding();
      setAccount(driverAccount);
      setOnboarding(onboardingState);
      setIsAuthenticated(true);
    } catch (error) {
      setAccount(null);
      setIsAuthenticated(false);
      setBootstrapError(
        error instanceof Error
          ? error.message
          : 'Could not verify your driver account.',
      );
    } finally {
      setInitializing(false);
    }
  }, []);

  const refreshOnboarding = useCallback(async () => {
    const state = await AuthService.getInstance().getOnboarding();
    setOnboarding(state);
    setAccount(current =>
      current ? { ...current, approvalStatus: state.approvalStatus } : current,
    );
  }, []);

  useEffect(() => {
    const authService = AuthService.getInstance();

    // observeAuthState handles Firebase auth state changes
    if (authService.observeAuthState) {
      const unsubscribe = authService.observeAuthState(async user => {
        if (user) {
          await bootstrap();
        } else {
          setIsAuthenticated(false);
          setAccount(null);
          setOnboarding(null);
          setBootstrapError(null);
          setInitializing(false);
        }
      });
      return unsubscribe;
    } else {
      // Mock mode without observeAuthState
      setInitializing(false);
      return () => {};
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
    (!onboarding?.eligible || account.approvalStatus !== 'APPROVED')
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
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!isAuthenticated ? (
        <Stack.Screen name="Auth" children={renderAuthStack} />
      ) : (
        <Stack.Screen name="Main" component={MainTabNavigator} />
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
