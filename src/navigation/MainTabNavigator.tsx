import React, { useEffect, useState } from 'react';
import { TrackingService } from '../services/tracking/TrackingService';
import { StyleSheet, View } from 'react-native';
import { NotificationBanner } from '../components/notifications/NotificationRuntime';
import Icon from '../components/atoms/Icon';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MainTabParamList } from '../types/navigation';
import { colors, typography } from '../theme';
import { HomeStack } from './stacks/HomeStack';
import { TripsStack } from './stacks/TripsStack';
import { EarningsStack } from './stacks/EarningsStack';
import { WalletStack } from './stacks/WalletStack';
import { AccountStack } from './stacks/AccountStack';
import { useI18n } from '../i18n';
import { IncomingTripOffer } from '../components/trips/IncomingTripOffer';
import { incomingOffers } from '../services/trip/incomingOfferRuntime';
import { TripController } from '../services/trip/TripController';

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
  const [offerHeight, setOfferHeight] = useState(0);
  useEffect(() => {
    const tracking = TrackingService.getInstance();
    tracking.startSession();
    return () => { tracking.detachSession(); incomingOffers.reset(); TripController.getInstance().resetSession(); };
  }, []);
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.container}>
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
        // Preserve the existing 56dp content area. BottomTabBar applies the live
        // bottom inset as padding itself; the custom total height must include it.
        tabBarStyle: [styles.tabBar, { height: 56 + insets.bottom }],
        tabBarItemStyle: styles.tabItem,
        tabBarHideOnKeyboard: true,
        sceneStyle: { paddingBottom: offerHeight },
      })}
    >
      <Tab.Screen name="HomeTab" component={HomeStack} />
      <Tab.Screen name="TripsTab" component={TripsStack} />
      <Tab.Screen name="EarningsTab" component={EarningsStack} />
      <Tab.Screen name="WalletTab" component={WalletStack} />
      <Tab.Screen name="AccountTab" component={AccountStack} options={{ popToTopOnBlur: false }} />
    </Tab.Navigator>
    <NotificationBanner />
    <IncomingTripOffer onHeight={setOfferHeight} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  },
  tabItem: { paddingBottom: 4 },
});

export default MainTabNavigator;

