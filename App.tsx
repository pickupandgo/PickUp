import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { RootNavigator } from './src/navigation/RootNavigator';
import { I18nProvider } from './src/i18n';
import { colors } from './src/theme';
import { driverNotificationService } from './src/services/notifications/NotificationService';
import { floatingBubbleService } from './src/services/overlay/FloatingBubbleService';

const navigationRef = createNavigationContainerRef<any>();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.surface,
  },
};

function App(): React.JSX.Element {
  useEffect(() => {
    floatingBubbleService.initialize().catch((err) => {
      console.warn('[App] Failed to initialize floating bubble service:', err);
    });

    driverNotificationService.setNavigationRef(navigationRef);
    driverNotificationService.requestPermission().then((granted) => {
      if (granted) {
        driverNotificationService.registerDeviceToken();
      }
    });

    const unsubscribe = driverNotificationService.initListeners();
    return () => {
      unsubscribe?.();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.surface }}>
      <I18nProvider>
        <SafeAreaProvider>
          <NavigationContainer ref={navigationRef} theme={navTheme}>
            <StatusBar barStyle="dark-content" />
            <RootNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

export default App;
