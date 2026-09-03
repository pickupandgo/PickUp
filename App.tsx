import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { BookingProvider } from './src/state/BookingContext';
import { getIsLoggedIn } from './src/state/session';
import { colors } from './src/theme';

import ActiveTripChatScreen from './src/screens/support/ActiveTripChatScreen';
import ActiveTripTrackingScreen from './src/screens/tracking/ActiveTripTrackingScreen';
import AddressSearchScreen from './src/screens/booking/AddressSearchScreen';
import AssignmentFailedScreen from './src/screens/support/AssignmentFailedScreen';
import BookingConfirmedScreen from './src/screens/booking/BookingConfirmedScreen';
import BookingReviewScreen from './src/screens/booking/BookingReviewScreen';
import CallDriverScreen from './src/screens/support/CallDriverScreen';
import CancellationChargeConfirmationScreen from './src/screens/support/CancellationChargeConfirmationScreen';
import CancellationConfirmationScreen from './src/screens/support/CancellationConfirmationScreen';
import CancellationReasonScreen from './src/screens/support/CancellationReasonScreen';
import CancellationResultScreen from './src/screens/support/CancellationResultScreen';
import CashPaymentStatusScreen from './src/screens/payment/CashPaymentStatusScreen';
import ChangeProfilePhotoScreen from './src/screens/profile/ChangeProfilePhotoScreen';
import CreateProfileScreen from './src/screens/profile/CreateProfileScreen';
import CurrentDropDetailsScreen from './src/screens/logistics/CurrentDropDetailsScreen';
import CustomerLiveTrackingScreen from './src/screens/tracking/CustomerLiveTrackingScreen';
import CustomerSettingsScreen from './src/screens/profile/CustomerSettingsScreen';
import DeclaredValueSelectionScreen from './src/screens/booking/DeclaredValueSelectionScreen';
import DigitalReceiptScreen from './src/screens/payment/DigitalReceiptScreen';
import DriverAssignedExpandedScreen from './src/screens/tracking/DriverAssignedExpandedScreen';
import DriverAssignedScreen from './src/screens/tracking/DriverAssignedScreen';
import DriverFoundScreen from './src/screens/tracking/DriverFoundScreen';
import DriverRatingScreen from './src/screens/support/DriverRatingScreen';
import DropCompletedStateScreen from './src/screens/logistics/DropCompletedStateScreen';
import DropOtpVerificationScreen from './src/screens/logistics/DropOtpVerificationScreen';
import EditProfileScreen from './src/screens/profile/EditProfileScreen';
import EmptyStateScreen from './src/screens/support/EmptyStateScreen';
import ErrorScreen from './src/screens/support/ErrorScreen';
import FareEstimateScreen from './src/screens/booking/FareEstimateScreen';
import FinalDeliverySummaryScreen from './src/screens/logistics/FinalDeliverySummaryScreen';
import FindingDriverScreen from './src/screens/tracking/FindingDriverScreen';
import GoodsDetailsScreen from './src/screens/logistics/GoodsDetailsScreen';
import GoodsInsuranceScreen from './src/screens/logistics/GoodsInsuranceScreen';
import HistoricalTripDetailScreen from './src/screens/profile/HistoricalTripDetailScreen';
import HomeScreen from './src/screens/home/HomeScreen';
import LiveTrackingExceptionsScreen from './src/screens/tracking/LiveTrackingExceptionsScreen';
import LiveTrackingScreen from './src/screens/tracking/LiveTrackingScreen';
import LoadingSkeletonScreen from './src/screens/support/LoadingSkeletonScreen';
import LoginScreen from './src/screens/auth/LoginScreen';
import LogoutConfirmationScreen from './src/screens/auth/LogoutConfirmationScreen';
import MapLoadingScreen from './src/screens/tracking/MapLoadingScreen';
import MultiDropOverviewScreen from './src/screens/logistics/MultiDropOverviewScreen';
import MultiDropProgressScreen from './src/screens/logistics/MultiDropProgressScreen';
import NetworkErrorScreen from './src/screens/support/NetworkErrorScreen';
import NextDropScreen from './src/screens/logistics/NextDropScreen';
import NoDriversAvailableScreen from './src/screens/support/NoDriversAvailableScreen';
import NotificationCenterScreen from './src/screens/support/NotificationCenterScreen';
import OtpVerificationScreen from './src/screens/auth/OtpVerificationScreen';
import PaymentConfirmationScreen from './src/screens/payment/PaymentConfirmationScreen';
import PaymentFailedScreen from './src/screens/payment/PaymentFailedScreen';
import PaymentMethodScreen from './src/screens/payment/PaymentMethodScreen';
import PaymentMethodSelectedScreen from './src/screens/payment/PaymentMethodSelectedScreen';
import PaymentPendingScreen from './src/screens/payment/PaymentPendingScreen';
import PaymentProcessingScreen from './src/screens/payment/PaymentProcessingScreen';
import PaymentSelectionScreen from './src/screens/payment/PaymentSelectionScreen';
import PaymentSuccessfulScreen from './src/screens/payment/PaymentSuccessfulScreen';
import PermissionScreen from './src/screens/auth/PermissionScreen';
import PickupOtpVerificationScreen from './src/screens/logistics/PickupOtpVerificationScreen';
import PickupVerifiedSuccessScreen from './src/screens/logistics/PickupVerifiedSuccessScreen';
import ProfileScreen from './src/screens/profile/ProfileScreen';
import ReceiverDetailsScreen from './src/screens/logistics/ReceiverDetailsScreen';
import ReconnectingScreen from './src/screens/tracking/ReconnectingScreen';
import RecordingConsentScreen from './src/screens/auth/RecordingConsentScreen';
import ReviewBookingScreen from './src/screens/booking/ReviewBookingScreen';
import RouteUnavailableScreen from './src/screens/support/RouteUnavailableScreen';
import SavedAddressesScreen from './src/screens/profile/SavedAddressesScreen';
import SearchingDriverScreen from './src/screens/tracking/SearchingDriverScreen';
import SearchUnavailableScreen from './src/screens/support/SearchUnavailableScreen';
import SelectDropLocationScreen from './src/screens/booking/SelectDropLocationScreen';
import SelectLocationScreen from './src/screens/booking/SelectLocationScreen';
import SelectVehicleScreen from './src/screens/booking/SelectVehicleScreen';
import ShareTrackingSheetScreen from './src/screens/support/ShareTrackingSheetScreen';
import TripCancelledStatusScreen from './src/screens/support/TripCancelledStatusScreen';
import TripCompletedScreen from './src/screens/support/TripCompletedScreen';
import TripCompletedSummaryScreen from './src/screens/support/TripCompletedSummaryScreen';
import TripHistoryScreen from './src/screens/profile/TripHistoryScreen';
import ValidateBookingScreen from './src/screens/booking/ValidateBookingScreen';
import VehicleSelectionScreen from './src/screens/booking/VehicleSelectionScreen';
import WrittenReviewScreen from './src/screens/support/WrittenReviewScreen';

const Stack = createNativeStackNavigator();

/**
 * Wrappers for screens that require props beyond `navigation`.
 * Declared at module scope (not inline in `component={...}`) so React Navigation
 * keeps a stable component identity and forwards `navigation`/`route` through.
 */
function PermissionRoute(props: any) {
  return <PermissionScreen variant="location" {...props} />;
}

function EmptyStateRoute(props: any) {
  return (
    <EmptyStateScreen
      title="No trips yet"
      description="Your completed and cancelled trips will show up here."
      buttonText="Start Booking"
      {...props}
      onButtonPress={() => props.navigation?.navigate('AddressSearchScreen')}
    />
  );
}

function ErrorRoute(props: any) {
  return <ErrorScreen variant="noInternet" {...props} />;
}

function GalleryScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.galleryContainer}>
      <Text style={styles.header}>Screen Gallery (76 Screens)</Text>
      <FlatList
        data={[
          'ActiveTripChatScreen', 'ActiveTripTrackingScreen', 'AddressSearchScreen', 'AssignmentFailedScreen', 'BookingConfirmedScreen', 'BookingReviewScreen', 'CallDriverScreen', 'CancellationChargeConfirmationScreen', 'CancellationConfirmationScreen', 'CancellationReasonScreen', 'CancellationResultScreen', 'CashPaymentStatusScreen', 'ChangeProfilePhotoScreen', 'CreateProfileScreen', 'CurrentDropDetailsScreen', 'CustomerLiveTrackingScreen', 'CustomerSettingsScreen', 'DeclaredValueSelectionScreen', 'DigitalReceiptScreen', 'DriverAssignedExpandedScreen', 'DriverAssignedScreen', 'DriverFoundScreen', 'DriverRatingScreen', 'DropCompletedStateScreen', 'DropOtpVerificationScreen', 'EditProfileScreen', 'EmptyStateScreen', 'ErrorScreen', 'FareEstimateScreen', 'FinalDeliverySummaryScreen', 'FindingDriverScreen', 'GoodsDetailsScreen', 'GoodsInsuranceScreen', 'HistoricalTripDetailScreen', 'HomeScreen', 'LiveTrackingExceptionsScreen', 'LiveTrackingScreen', 'LoadingSkeletonScreen', 'LoginScreen', 'LogoutConfirmationScreen', 'MapLoadingScreen', 'MultiDropOverviewScreen', 'MultiDropProgressScreen', 'NetworkErrorScreen', 'NextDropScreen', 'NoDriversAvailableScreen', 'NotificationCenterScreen', 'OtpVerificationScreen', 'PaymentConfirmationScreen', 'PaymentFailedScreen', 'PaymentMethodScreen', 'PaymentMethodSelectedScreen', 'PaymentPendingScreen', 'PaymentProcessingScreen', 'PaymentSelectionScreen', 'PaymentSuccessfulScreen', 'PermissionScreen', 'PickupOtpVerificationScreen', 'PickupVerifiedSuccessScreen', 'ProfileScreen', 'ReceiverDetailsScreen', 'ReconnectingScreen', 'RecordingConsentScreen', 'ReviewBookingScreen', 'RouteUnavailableScreen', 'SavedAddressesScreen', 'SearchingDriverScreen', 'SearchUnavailableScreen', 'SelectDropLocationScreen', 'SelectLocationScreen', 'SelectVehicleScreen', 'ShareTrackingSheetScreen', 'TripCancelledStatusScreen', 'TripCompletedScreen', 'TripCompletedSummaryScreen', 'TripHistoryScreen', 'ValidateBookingScreen', 'VehicleSelectionScreen', 'WrittenReviewScreen'
        ]}
        keyExtractor={item => item}
        renderItem={({item}) => (
          <Pressable style={styles.item} onPress={() => navigation.navigate(item)}>
            <Text style={styles.itemText}>{item}</Text>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

export default function App() {
  // While we read the persisted login flag, `initialRoute` stays undefined and
  // we show a splash. Once known, the navigator mounts with the right entry
  // screen: HomeScreen if logged in, LoginScreen otherwise.
  const [initialRoute, setInitialRoute] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getIsLoggedIn().then((loggedIn) => {
      if (mounted) {
        setInitialRoute(loggedIn ? 'HomeScreen' : 'LoginScreen');
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  if (initialRoute === null) {
    return (
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <View style={styles.splash}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <BookingProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRoute}>
          <Stack.Screen name="Gallery" component={GalleryScreen} />
        <Stack.Screen name="ActiveTripChatScreen" component={ActiveTripChatScreen} />
        <Stack.Screen name="ActiveTripTrackingScreen" component={ActiveTripTrackingScreen} />
        <Stack.Screen name="AddressSearchScreen" component={AddressSearchScreen} />
        <Stack.Screen name="AssignmentFailedScreen" component={AssignmentFailedScreen} />
        <Stack.Screen name="BookingConfirmedScreen" component={BookingConfirmedScreen} />
        <Stack.Screen name="BookingReviewScreen" component={BookingReviewScreen} />
        <Stack.Screen name="CallDriverScreen" component={CallDriverScreen} />
        <Stack.Screen name="CancellationChargeConfirmationScreen" component={CancellationChargeConfirmationScreen} />
        <Stack.Screen name="CancellationConfirmationScreen" component={CancellationConfirmationScreen} />
        <Stack.Screen name="CancellationReasonScreen" component={CancellationReasonScreen} />
        <Stack.Screen name="CancellationResultScreen" component={CancellationResultScreen} />
        <Stack.Screen name="CashPaymentStatusScreen" component={CashPaymentStatusScreen} />
        {/* Bottom-sheet screen: presented over the previous screen so its scrim reads as an overlay. */}
        <Stack.Screen
          name="ChangeProfilePhotoScreen"
          component={ChangeProfilePhotoScreen}
          options={{ presentation: 'transparentModal', animation: 'fade' }}
        />
        <Stack.Screen name="CreateProfileScreen" component={CreateProfileScreen} />
        <Stack.Screen name="CurrentDropDetailsScreen" component={CurrentDropDetailsScreen} />
        <Stack.Screen name="CustomerLiveTrackingScreen" component={CustomerLiveTrackingScreen} />
        <Stack.Screen name="CustomerSettingsScreen" component={CustomerSettingsScreen} />
        <Stack.Screen name="DeclaredValueSelectionScreen" component={DeclaredValueSelectionScreen} />
        <Stack.Screen name="DigitalReceiptScreen" component={DigitalReceiptScreen} />
        <Stack.Screen name="DriverAssignedExpandedScreen" component={DriverAssignedExpandedScreen} />
        <Stack.Screen name="DriverAssignedScreen" component={DriverAssignedScreen} />
        <Stack.Screen name="DriverFoundScreen" component={DriverFoundScreen} />
        <Stack.Screen name="DriverRatingScreen" component={DriverRatingScreen} />
        <Stack.Screen name="DropCompletedStateScreen" component={DropCompletedStateScreen} />
        <Stack.Screen name="DropOtpVerificationScreen" component={DropOtpVerificationScreen} />
        <Stack.Screen name="EditProfileScreen" component={EditProfileScreen} />
        <Stack.Screen name="EmptyStateScreen" component={EmptyStateRoute} />
        <Stack.Screen name="ErrorScreen" component={ErrorRoute} />
        <Stack.Screen name="FareEstimateScreen" component={FareEstimateScreen} />
        <Stack.Screen name="FinalDeliverySummaryScreen" component={FinalDeliverySummaryScreen} />
        <Stack.Screen name="FindingDriverScreen" component={FindingDriverScreen} />
        <Stack.Screen name="GoodsDetailsScreen" component={GoodsDetailsScreen} />
        <Stack.Screen name="GoodsInsuranceScreen" component={GoodsInsuranceScreen} />
        <Stack.Screen name="HistoricalTripDetailScreen" component={HistoricalTripDetailScreen} />
        <Stack.Screen name="HomeScreen" component={HomeScreen} />
        <Stack.Screen name="LiveTrackingExceptionsScreen" component={LiveTrackingExceptionsScreen} />
        <Stack.Screen name="LiveTrackingScreen" component={LiveTrackingScreen} />
        <Stack.Screen name="LoadingSkeletonScreen" component={LoadingSkeletonScreen} />
        <Stack.Screen name="LoginScreen" component={LoginScreen} />
        <Stack.Screen name="LogoutConfirmationScreen" component={LogoutConfirmationScreen} />
        <Stack.Screen name="MapLoadingScreen" component={MapLoadingScreen} />
        <Stack.Screen name="MultiDropOverviewScreen" component={MultiDropOverviewScreen} />
        <Stack.Screen name="MultiDropProgressScreen" component={MultiDropProgressScreen} />
        <Stack.Screen name="NetworkErrorScreen" component={NetworkErrorScreen} />
        <Stack.Screen name="NextDropScreen" component={NextDropScreen} />
        <Stack.Screen name="NoDriversAvailableScreen" component={NoDriversAvailableScreen} />
        <Stack.Screen name="NotificationCenterScreen" component={NotificationCenterScreen} />
        <Stack.Screen name="OtpVerificationScreen" component={OtpVerificationScreen} />
        <Stack.Screen name="PaymentConfirmationScreen" component={PaymentConfirmationScreen} />
        <Stack.Screen name="PaymentFailedScreen" component={PaymentFailedScreen} />
        <Stack.Screen name="PaymentMethodScreen" component={PaymentMethodScreen} />
        <Stack.Screen name="PaymentMethodSelectedScreen" component={PaymentMethodSelectedScreen} />
        <Stack.Screen name="PaymentPendingScreen" component={PaymentPendingScreen} />
        <Stack.Screen name="PaymentProcessingScreen" component={PaymentProcessingScreen} />
        <Stack.Screen name="PaymentSelectionScreen" component={PaymentSelectionScreen} />
        <Stack.Screen name="PaymentSuccessfulScreen" component={PaymentSuccessfulScreen} />
        <Stack.Screen name="PermissionScreen" component={PermissionRoute} />
        <Stack.Screen name="PickupOtpVerificationScreen" component={PickupOtpVerificationScreen} />
        <Stack.Screen name="PickupVerifiedSuccessScreen" component={PickupVerifiedSuccessScreen} />
        <Stack.Screen name="ProfileScreen" component={ProfileScreen} />
        <Stack.Screen name="ReceiverDetailsScreen" component={ReceiverDetailsScreen} />
        <Stack.Screen name="ReconnectingScreen" component={ReconnectingScreen} />
        <Stack.Screen name="RecordingConsentScreen" component={RecordingConsentScreen} />
        <Stack.Screen name="ReviewBookingScreen" component={ReviewBookingScreen} />
        <Stack.Screen name="RouteUnavailableScreen" component={RouteUnavailableScreen} />
        <Stack.Screen name="SavedAddressesScreen" component={SavedAddressesScreen} />
        <Stack.Screen name="SearchingDriverScreen" component={SearchingDriverScreen} />
        <Stack.Screen name="SearchUnavailableScreen" component={SearchUnavailableScreen} />
        <Stack.Screen name="SelectDropLocationScreen" component={SelectDropLocationScreen} />
        <Stack.Screen name="SelectLocationScreen" component={SelectLocationScreen} />
        <Stack.Screen name="SelectVehicleScreen" component={SelectVehicleScreen} />
        <Stack.Screen name="ShareTrackingSheetScreen" component={ShareTrackingSheetScreen} />
        <Stack.Screen name="TripCancelledStatusScreen" component={TripCancelledStatusScreen} />
        <Stack.Screen name="TripCompletedScreen" component={TripCompletedScreen} />
        <Stack.Screen name="TripCompletedSummaryScreen" component={TripCompletedSummaryScreen} />
        <Stack.Screen name="TripHistoryScreen" component={TripHistoryScreen} />
        <Stack.Screen name="ValidateBookingScreen" component={ValidateBookingScreen} />
        <Stack.Screen name="VehicleSelectionScreen" component={VehicleSelectionScreen} />
        <Stack.Screen name="WrittenReviewScreen" component={WrittenReviewScreen} />
        </Stack.Navigator>
      </NavigationContainer>
      </BookingProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  galleryContainer: { flex: 1, backgroundColor: '#fff' },
  header: { fontSize: 24, fontWeight: 'bold', padding: 20, borderBottomWidth: 1, borderColor: '#eee' },
  item: { padding: 16, borderBottomWidth: 1, borderColor: '#f0f0f0' },
  itemText: { fontSize: 16, color: '#333' },
});
