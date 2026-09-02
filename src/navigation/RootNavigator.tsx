import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';

import LoginScreen from '../screens/auth/LoginScreen';
import HomeScreen from '../screens/home/HomeScreen';
import SelectVehicleScreen from '../screens/booking/SelectVehicleScreen';
import ReviewBookingScreen from '../screens/booking/ReviewBookingScreen';
import LiveTrackingScreen from '../screens/tracking/LiveTrackingScreen';
import TripHistoryScreen from '../screens/profile/TripHistoryScreen';
import TripCompletedScreen from '../screens/support/TripCompletedScreen';
import PaymentSelectionScreen from '../screens/payment/PaymentSelectionScreen';
import ProfileScreen from '../screens/profile/ProfileScreen';
import PermissionScreen from '../screens/auth/PermissionScreen';

export interface RootNavigatorProps {}

const Stack = createNativeStackNavigator<RootStackParamList>();

const RootNavigator: React.FC<RootNavigatorProps> = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Login"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen
          name="LocationPermission"
          component={() => (
            <PermissionScreen variant="location" />
          )}
        />
        <Stack.Screen
          name="NotificationPermission"
          component={() => (
            <PermissionScreen variant="notification" />
          )}
        />
        <Stack.Screen
          name="CameraPermission"
          component={() => (
            <PermissionScreen variant="camera" />
          )}
        />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="SelectVehicle" component={SelectVehicleScreen} />
        <Stack.Screen name="ReviewBooking" component={ReviewBookingScreen} />
        <Stack.Screen name="LiveTracking" component={LiveTrackingScreen} />
        <Stack.Screen name="TripHistory" component={TripHistoryScreen} />
        <Stack.Screen name="TripCompleted" component={TripCompletedScreen} />
        <Stack.Screen name="PaymentSelection" component={PaymentSelectionScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default RootNavigator;
