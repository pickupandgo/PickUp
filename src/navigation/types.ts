/**
 * Root navigation configuration for the Pick Up Customer App.
 * Uses React Navigation with a native stack navigator.
 */

export type RootStackParamList = {
  Login: undefined;
  LocationPermission: undefined;
  NotificationPermission: undefined;
  CameraPermission: undefined;
  Home: undefined;
  SelectVehicle: undefined;
  ReviewBooking: undefined;
  LiveTracking: undefined;
  TripHistory: undefined;
  TripCompleted: undefined;
  PaymentSelection: undefined;
  Profile: undefined;
};

export type TabParamList = {
  HomeTab: undefined;
  TripsTab: undefined;
  AccountTab: undefined;
};
