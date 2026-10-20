import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { RootNavigator } from './src/navigation/RootNavigator';
import { I18nProvider } from './src/i18n';
import { driverNotificationService } from './src/services/notifications/NotificationService';

const navigationRef = createNavigationContainerRef<any>();

function App(): React.JSX.Element {
  useEffect(() => {
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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <I18nProvider>
        <SafeAreaProvider>
          <NavigationContainer ref={navigationRef}>
            <StatusBar barStyle="dark-content" />
            <RootNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

export default App;
