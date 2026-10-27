/**
 * Navigation type definitions for React Navigation.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps, NavigatorScreenParams } from '@react-navigation/native';
import type { TripOffer, HistoricalTrip } from './trip';

// ─── Auth Stack ────────────────────────────────────────────────────

export interface DriverRegistrationData {
  readonly fullName: string;
  readonly phone: string;
  readonly email?: string;
  readonly vehicleType: string;
  readonly vehicleRegistrationNumber: string;
  readonly vehicleMakeModel: string;
  readonly drivingLicenseNumber: string;
}

export type AuthStackParamList = {
  UnifiedAuth: undefined;
  DriverRegistration: { readonly phone?: string } | undefined;
  OTPVerification: {
    readonly phone: string;
    readonly intendedRole?: 'driver';
    readonly authMode?: 'signup' | 'login';
    readonly registrationData?: DriverRegistrationData;
    readonly driverData?: {
      readonly name?: string;
      readonly email?: string;
      readonly vehicleMake?: string;
      readonly licensePlate?: string;
    };
  };
  VehicleSelection: { readonly language: string };
  LanguageSelection: undefined;
  PendingVerification: {
    readonly driverId?: string;
    readonly legalName?: string;
    readonly phone?: string;
    readonly vehicleType?: string;
    readonly vehicleRegistrationNumber?: string;
    readonly approvalStatus?: string;
  } | undefined;
};

// ─── Home Stack ────────────────────────────────────────────────────

export type HomeStackParamList = {
  DriverHome: undefined;
  NotificationCenter: undefined;
  VehicleSelection?: { readonly language?: string };
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
  /** Pickup / delivery payment. `tripId` is the payments backend's trip id (not the engine's). */
  CollectPayment: { readonly tripId: string };
};

// ─── Trips Stack ───────────────────────────────────────────────────

export type TripsStackParamList = {
  TripHistory: undefined;
  HistoricalTripDetail: { readonly tripId: string; readonly trip?: HistoricalTrip };
};

// ─── Earnings Stack ────────────────────────────────────────────────

export type EarningsStackParamList = {
  EarningsHistory: undefined;
  TripEarningsDetail: { readonly tripId: string };
};

// ─── Wallet Stack ──────────────────────────────────────────────────

export type RechargeOutcomeKind = 'success' | 'pending' | 'cancelled' | 'failed';

export type WalletStackParamList = {
  DriverWallet: undefined;
  Recharge: undefined;
  /** One recharge attempt. The key is reused for every retry of this attempt. */
  RechargeProcessing: { readonly amountPaise: number; readonly idempotencyKey: string };
  RechargeResult: {
    readonly outcome: RechargeOutcomeKind;
    readonly amountPaise: number;
    readonly paymentId?: string;
    /** New wallet balance, when the server returned it. */
    readonly balancePaise?: number;
    /** Driver-safe failure message. */
    readonly message?: string;
    /** Server request id, shown as a support reference. */
    readonly requestId?: string;
    /** True when Checkout was used, so money may have left the driver's account. */
    readonly paymentAttempted?: boolean;
  };
  TransactionHistory: undefined;
};

// ─── Account Stack ─────────────────────────────────────────────────

export type AccountStackParamList = {
  Profile: undefined;
  KYCDocuments: undefined;
  VehicleDocuments: undefined;
  VehicleStatus: undefined;
  VehicleSelection?: { readonly language?: string };
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
  PendingVerification: NavigatorScreenParams<AuthStackParamList> | undefined;
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
