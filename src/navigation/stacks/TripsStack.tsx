import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { TripsStackParamList } from '../../types/navigation';

import { TripHistoryScreen } from '../../screens/trips/TripHistoryScreen';
import { TripDetailsScreen } from '../../screens/trips/HistoricalTripDetailScreen';

const Stack = createNativeStackNavigator<TripsStackParamList>();

export const TripsStack: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="TripHistory" component={TripHistoryScreen} />
      <Stack.Screen name="HistoricalTripDetail" component={TripDetailsScreen} />
    </Stack.Navigator>
  );
};

export default TripsStack;
