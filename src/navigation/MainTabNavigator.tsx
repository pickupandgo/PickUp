import React from 'react';
import { Text, StyleSheet } from 'react-native';
import Icon from '../components/atoms/Icon';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from '../types/navigation';
import { colors, typography } from '../theme';
import { HomeStack } from './stacks/HomeStack';
import { TripsStack } from './stacks/TripsStack';
import { EarningsStack } from './stacks/EarningsStack';
import { WalletStack } from './stacks/WalletStack';
import { AccountStack } from './stacks/AccountStack';
import { useI18n } from '../i18n';

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Record<keyof MainTabParamList, string> = {
  HomeTab: 'home',
  TripsTab: 'route',
  EarningsTab: 'payments',
  WalletTab: 'account_balance_wallet',
  AccountTab: 'person',
};

const TAB_LABEL_KEYS: Record<keyof MainTabParamList, string> = {
  HomeTab: 'tab.home',
  TripsTab: 'tab.trips',
  EarningsTab: 'tab.earnings',
  WalletTab: 'tab.wallet',
  AccountTab: 'tab.account',
};

export const MainTabNavigator: React.FC = () => {
  const { t } = useI18n();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => (
          <Icon
            name={TAB_ICONS[route.name]}
            color={focused ? colors.primary : colors.outline}
            style={styles.tabIcon}
          />
        ),
        tabBarLabel: t(TAB_LABEL_KEYS[route.name]),
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.outline,
        tabBarLabelStyle: styles.tabLabel,
        tabBarStyle: styles.tabBar,
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} />
      <Tab.Screen name="TripsTab" component={TripsStack} />
      <Tab.Screen name="EarningsTab" component={EarningsStack} />
      <Tab.Screen name="WalletTab" component={WalletStack} />
      <Tab.Screen name="AccountTab" component={AccountStack} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  tabIcon: {
    fontSize: 24,
  },
  tabLabel: {
    ...typography.labelSm,
    fontSize: 10,
  },
  tabBar: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    backgroundColor: colors.surfaceContainerLowest,
    paddingBottom: 4,
    height: 56,
  },
});

export default MainTabNavigator;

