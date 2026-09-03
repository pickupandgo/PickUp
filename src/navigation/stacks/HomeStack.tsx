import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../../types/navigation';

// Home screens
import { DriverHomeScreen } from '../../screens/home/DriverHomeScreen';
import { NotificationCenterScreen } from '../../screens/home/NotificationCenterScreen';

// Trip flow screens
import { NewTripOfferScreen } from '../../screens/trip/NewTripOfferScreen';
import { ActiveTripScreen } from '../../screens/trip/ActiveTripScreen';
import { NavigationScreen } from '../../screens/trip/NavigationScreen';
import { MultiStopJourneyScreen } from '../../screens/trip/MultiStopJourneyScreen';
import { ArrivedAtPickupScreen } from '../../screens/trip/ArrivedAtPickupScreen';
import { PickupOTPScreen } from '../../screens/trip/PickupOTPScreen';
import { DropOTPScreen } from '../../screens/trip/DropOTPScreen';
import { DeliveryProofCameraScreen } from '../../screens/trip/DeliveryProofCameraScreen';
import { DeliveryProofPreviewScreen } from '../../screens/trip/DeliveryProofPreviewScreen';
import { TripCompletedScreen } from '../../screens/trip/TripCompletedScreen';
import { CancellationReasonScreen } from '../../screens/trip/CancellationReasonScreen';
import { CancellationProcessingScreen } from '../../screens/trip/CancellationProcessingScreen';
import { CancellationResultScreen } from '../../screens/trip/CancellationResultScreen';
import { ActiveTripChatScreen } from '../../screens/trip/ActiveTripChatScreen';

const Stack = createNativeStackNavigator<HomeStackParamList>();

export const HomeStack: React.FC = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      {/* Home */}
      <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
      <Stack.Screen name="NotificationCenter" component={NotificationCenterScreen} />

      {/* Active Trip Flow */}
      <Stack.Screen name="TripOffer" component={NewTripOfferScreen} />
      <Stack.Screen name="ActiveTrip" component={ActiveTripScreen} />
      <Stack.Screen name="Navigation" component={NavigationScreen} />
      <Stack.Screen name="MultiStopJourney" component={MultiStopJourneyScreen} />

      {/* Pickup Verification */}
      <Stack.Screen name="ArrivedAtPickup" component={ArrivedAtPickupScreen} />
      <Stack.Screen name="PickupOTP" component={PickupOTPScreen} />

      {/* Drop Verification + Delivery Proof */}
      <Stack.Screen name="DropOTP" component={DropOTPScreen} />
      <Stack.Screen
        name="DeliveryProofCamera"
        component={DeliveryProofCameraScreen}
        options={{ animation: 'fade' }}
      />
      <Stack.Screen name="DeliveryProofPreview" component={DeliveryProofPreviewScreen} />

      {/* Trip Completion */}
      <Stack.Screen
        name="TripCompleted"
        component={TripCompletedScreen}
        options={{ animation: 'fade', gestureEnabled: false }}
      />

      {/* Cancellation Flow */}
      <Stack.Screen name="CancellationReason" component={CancellationReasonScreen} />
      <Stack.Screen
        name="CancellationProcessing"
        component={CancellationProcessingScreen}
        options={{ gestureEnabled: false }}
      />
      <Stack.Screen
        name="CancellationResult"
        component={CancellationResultScreen}
        options={{ gestureEnabled: false }}
      />

      {/* In-Trip Chat */}
      <Stack.Screen name="ActiveTripChat" component={ActiveTripChatScreen} />
    </Stack.Navigator>
  );
};

export default HomeStack;
