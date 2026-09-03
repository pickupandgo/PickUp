import React from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { RootNavigator } from './src/navigation/RootNavigator';
import { I18nProvider } from './src/i18n';
import { colors } from './src/theme';

function App(): React.JSX.Element {
  console.log('APP IS RENDERING');
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <I18nProvider>
        <SafeAreaProvider>
          <NavigationContainer>
            <StatusBar barStyle="dark-content" />
            <RootNavigator />
          </NavigationContainer>
        </SafeAreaProvider>
      </I18nProvider>
    </GestureHandlerRootView>
  );
}

export default App;
