/**
 * Navigation type definitions for React Navigation.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { TripOffer } from './trip';

// ─── Auth Stack ────────────────────────────────────────────────────

export type AuthStackParamList = {
  UnifiedAuth: undefined;
  OTPVerification: { readonly phone: string; readonly intendedRole?: 'driver'; readonly authMode?: 'signup' | 'login' };
  VehicleSelection: { readonly language: string };
  LanguageSelection: undefined;
};

// ─── Home Stack ────────────────────────────────────────────────────

export type HomeStackParamList = {
  DriverHome: undefined;
  NotificationCenter: undefined;
  ActiveTrip: { readonly tripId: string };
  Navigation: { readonly tripId: string };
  MultiStopJourney: { readonly tripId: string };
  ArrivedAtPickup: { readonly tripId: string; readonly stopId: string };
  PickupOTP: { readonly tripId: string; readonly stopId: string };
  DropOTP: { readonly tripId: string; readonly stopId: string };
  DeliveryProofCamera: { readonly tripId: string; readonly stopId: string };
  DeliveryProofPreview: { readonly tripId: string; readonly stopId: string; readonly photoUri: string };
  TripCompleted: { readonly tripId: string };
  CancellationReason: { readonly tripId: string };
  CancellationProcessing: { readonly tripId: string; readonly reason: string };
  CancellationResult: { readonly tripId: string; readonly success: boolean };
  ActiveTripChat: { readonly tripId: string };
  TripOffer: { readonly offer: TripOffer; readonly driverId: string };
};

// ─── Trips Stack ───────────────────────────────────────────────────

export type TripsStackParamList = {
  TripHistory: undefined;
  HistoricalTripDetail: { readonly tripId: string };
};

// ─── Earnings Stack ────────────────────────────────────────────────

export type EarningsStackParamList = {
  EarningsHistory: undefined;
  TripEarningsDetail: { readonly tripId: string };
};

// ─── Wallet Stack ──────────────────────────────────────────────────

export type WalletStackParamList = {
  DriverWallet: undefined;
  Recharge: undefined;
  RechargeProcessing: { readonly amount: number; readonly paymentMethodId: string };
  RechargeResult: { readonly success: boolean; readonly amount?: number };
  TransactionHistory: undefined;
};

// ─── Account Stack ─────────────────────────────────────────────────

export type AccountStackParamList = {
  Profile: undefined;
  KYCDocuments: undefined;
  VehicleDocuments: undefined;
  VehicleStatus: undefined;
  Settings: undefined;
  Subscription: undefined;
  SubscriptionProcessing: undefined;
  SubscriptionResult: { readonly success: boolean };
  LanguageSelection: undefined;
  AccountRestricted: undefined;
};

// ─── Main Tab Navigator ───────────────────────────────────────────

export type MainTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  TripsTab: NavigatorScreenParams<TripsStackParamList>;
  EarningsTab: NavigatorScreenParams<EarningsStackParamList>;
  WalletTab: NavigatorScreenParams<WalletStackParamList>;
  AccountTab: NavigatorScreenParams<AccountStackParamList>;
};

// ─── Root Navigator ────────────────────────────────────────────────

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<AuthStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
};

// ─── Screen Props Helpers ──────────────────────────────────────────

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type HomeScreenProps<T extends keyof HomeStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<HomeStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type TripsScreenProps<T extends keyof TripsStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<TripsStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type EarningsScreenProps<T extends keyof EarningsStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<EarningsStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type WalletScreenProps<T extends keyof WalletStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<WalletStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type AccountScreenProps<T extends keyof AccountStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<AccountStackParamList, T>,
    BottomTabScreenProps<MainTabParamList>
  >;

export type RootScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
