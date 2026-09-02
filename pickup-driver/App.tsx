import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { DriverProvider } from './src/state/DriverContext';
import DriverHomeScreen from './src/screens/DriverHomeScreen';
import DriverTripScreen from './src/screens/DriverTripScreen';

const Stack = createNativeStackNavigator();

/** Pick Up Driver — standalone app, separate from the customer app. */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <DriverProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="DriverHome">
            <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
            <Stack.Screen name="DriverTrip" component={DriverTripScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </DriverProvider>
    </SafeAreaProvider>
  );
}
