import type { TripOffer, ActiveTrip, TripStop, HistoricalTrip, TripEarnings } from '../types/trip';
import type {
  DriverProfile,
  Vehicle,
  KycDocument,
  Subscription,
  Notification,
  SettingsSection,
} from '../types/user';
import type { ChatMessage } from '../types/chat';
/**
 * Mock data for all screens.
 *
 * RULE: All static text, image URLs, and lists must live here.
 * Components must not hardcode content — only reference this file or accept props.
 */

import type { WalletBalance, Transaction, PaymentMethodInfo, EarningsSummary } from '../types/wallet';

// ───  ───

export const authData = {
  appName: 'Pick Up',
  loginTitle: 'Driver Login',
  loginSubtitle: 'Enter your mobile number to securely access your logistics dashboard.',
  countryCode: '+91',
  otpTitle: 'Verify OTP',
  otpSubtitle: 'Enter the 6-digit code sent to',
  resendTimerSeconds: 30,
  resendText: 'Resend Code',
} as const;

export const languages = [
  { id: 'en', label: 'English', initial: 'E', selected: true },
  { id: 'hi', label: 'Hindi', initial: 'H', selected: false },
] as const;

// ───  ───

export const vehicleCategories = [
  { id: 'two_wheeler', name: 'Bike / 2-Wheeler', iconName: 'directions_bike', description: 'Bike / Scooter' },
  { id: 'three_wheeler', name: '3-Wheeler / E-Loader', iconName: 'local_shipping', description: 'Auto / Tempo' },
  { id: 'mini_truck', name: 'Mini Truck / Tata Ace', iconName: 'rv_hookup', description: 'Tata Ace / Similar' },
  { id: 'pickup', name: 'Pickup / Bolero', iconName: 'directions_car', description: 'Pickup / Bolero' },
  { id: 'jcb', name: 'JCB', iconName: 'precision_manufacturing', description: 'JCB' },
  { id: 'crane', name: 'Crane', iconName: 'construction', description: 'Crane' },
] as const;

// ───  ───

export const mockDriverProfile: DriverProfile = {
  id: 'DRV-001',
  name: 'Rajesh Kumar',
  phone: '+91 98765 43210',
  avatarUrl: undefined,
  location: 'Mumbai, Maharashtra',
  profileCompletionPercent: 85,
  status: 'offline',
  language: 'English',
};

// ───  ───

export const mockVehicle: Vehicle = {
  id: 'VEH-001',
  type: 'mini_truck',
  name: 'Tata Ace',
  registration: 'RJ 19 XX 1234',
  status: 'approved',
  iconName: 'local_shipping',
};

// ───  ───

export const homeData = {
  headerTitle: 'Driver Hub',
  liveLabel: 'LIVE',
  offlineLabel: 'OFFLINE',
  availableText: 'Available for nearby trips',
  findingTripTitle: 'Finding your next trip',
  findingTripSubtitle: 'Stay in high-demand areas for faster matches',
  offlineTitle: "You're Offline",
  offlineSubtitle: 'Go Live to start receiving trip requests.',
  currentVehicleLabel: 'CURRENT VEHICLE',
  todayLabel: 'TODAY',
  walletLabel: 'WALLET',
  detailsLabel: 'DETAILS',
  rechargeLabel: 'RECHARGE',
  deliveryProtocolTitle: 'Delivery Protocol',
  deliveryProtocolText: 'Delivery photo required at each drop location. Ensure clear visibility of package.',
  minBalancePrefix: 'Min',
} as const;

export const goLiveSheet = {
  title: 'Go Live',
  description: "To receive nearby trip requests and support live trip operations, Pick Up needs your location while you're working.",
  continueLabel: 'CONTINUE',
  cancelLabel: 'CANCEL',
} as const;

// ───  ───

export const mockTripOffer: TripOffer = {
  id: '8492-AX',
  estimatedEarning: 450,
  currency: '₹',
  pickupStop: {
    id: 'stop-1',
    type: 'pickup',
    label: 'PICKUP',
    address: 'Tech Park, Block C, Main Gate',
    latitude: 19.076,
    longitude: 72.8777,
    status: 'pending',
    etaMinutes: 4,
    notes: 'Ready now — Dock 4',
  },
  dropStops: [
    {
      id: 'stop-2',
      type: 'drop',
      label: 'DROP-OFF',
      address: 'Warehouse 42, Industrial Area',
      latitude: 19.0596,
      longitude: 72.8295,
      status: 'pending',
      notes: '1st of 2 drops',
    },
    {
      id: 'stop-3',
      type: 'drop',
      label: 'DROP-OFF',
      address: 'Retail Hub, Sector 18',
      latitude: 19.0496,
      longitude: 72.8195,
      status: 'pending',
      notes: 'Final drop',
    },
  ],
  totalDistanceKm: 8.5,
  loadType: 'box_parcel',
  vehicleType: 'Mini Truck',
  expiresAt: Date.now() + 13000,
  demandLevel: 'high',
};

export const tripOfferLabels = {
  estEarningLabel: 'EST. EARNING',
  pickupLabel: 'PICKUP',
  dropOffLabel: 'DROP-OFF',
  totalDistanceLabel: 'TOTAL DISTANCE',
  loadTypeLabel: 'LOAD TYPE',
  acceptLabel: 'ACCEPT',
  declineLabel: 'DECLINE',
  statusOnlineLabel: 'STATUS: ONLINE',
  minsAwayLabel: 'MINS AWAY',
  tripOfferTitle: 'TRIP OFFER',
  tripAcceptedTitle: 'Trip Accepted!',
  tripAcceptedSubtitle: 'Redirecting to Navigation...',
  offerExpiredTitle: 'Offer Expired',
  offerExpiredSubtitle: 'This trip has been assigned to another driver.',
} as const;

// ───  ───

export const mockActiveTrip: ActiveTrip = {
  id: 'TRP-4821',
  status: 'en_route_pickup',
  stops: [
    {
      id: 'stop-p1',
      type: 'pickup',
      label: 'Pickup',
      address: 'Grandview Warehouse',
      latitude: 19.076,
      longitude: 72.8777,
      status: 'current',
    },
    {
      id: 'stop-d1',
      type: 'drop',
      label: 'Drop 1',
      address: 'Deepwater Port',
      latitude: 19.0596,
      longitude: 72.8295,
      status: 'pending',
    },
    {
      id: 'stop-d2',
      type: 'drop',
      label: 'Drop 2 of 3',
      address: 'Pal Road',
      latitude: 19.0330,
      longitude: 72.8497,
      status: 'pending',
    },
    {
      id: 'stop-d3',
      type: 'drop_final',
      label: 'Drop 3',
      address: "Baner Phase 2",
      latitude: 19.0450,
      longitude: 72.8300,
      status: 'pending',
    },
  ],
  currentStopIndex: 0,
  estimatedEarning: 450,
  currency: '₹',
  totalDistanceKm: 8.5,
  loadType: 'box_parcel',
  goodsType: 'Box / Parcel',
  vehicleId: 'VEH-001',
  vehicleRegistration: 'RJ 19 XX 1234',
};

export const activeTripLabels = {
  navigateLabel: 'NAVIGATE',
  openTripLabel: 'OPEN TRIP',
  tripDetailsLabel: 'TRIP DETAILS',
  arrivedAtPickupTitle: 'ARRIVED AT PICKUP',
  verifyPickupLabel: 'VERIFY PICKUP',
  etaLabel: 'ETA',
  distanceLabel: 'DISTANCE',
  statusLabel: 'STATUS',
  onTimeLabel: 'On Time',
  gpsWeakLabel: 'GPS Signal Weak',
  reconnectingLabel: 'Reconnecting...',
} as const;

// ───  ───

export const otpVerificationLabels = {
  pickupOtpTitle: 'Verify Pickup',
  pickupOtpSubtitle: 'Enter the OTP shared by the sender to confirm pickup.',
  dropOtpTitle: 'Verify Drop-off',
  dropOtpSubtitle: 'Enter the OTP shared by the receiver to confirm delivery.',
  verifyLabel: 'VERIFY',
  successTitle: 'Verified Successfully!',
  errorTitle: 'Verification Failed',
  errorSubtitle: 'The OTP entered is incorrect. Please try again.',
} as const;

// ───  ───

export const deliveryProofLabels = {
  cameraTitle: 'Delivery Photo',
  cameraInstructions: 'Position the package clearly within the frame',
  captureLabel: 'CAPTURE',
  retakeLabel: 'RETAKE',
  confirmLabel: 'CONFIRM & UPLOAD',
  uploadSuccessTitle: 'Photo Uploaded',
  uploadSuccessSubtitle: 'Delivery proof has been recorded successfully.',
} as const;

// ───  ───

export const tripCompletedLabels = {
  title: 'Trip Completed!',
  earningsLabel: 'EARNINGS',
  distanceLabel: 'DISTANCE',
  stopsLabel: 'STOPS',
  journeyRecapTitle: 'Journey Recap',
  backToHomeLabel: 'BACK TO HOME',
  viewEarningsLabel: 'VIEW EARNINGS',
  rateExperienceLabel: 'RATE EXPERIENCE',
} as const;

// ───  ───

export const cancellationReasons = [
  { id: 'vehicle_breakdown', label: 'Vehicle Breakdown / Mechanical Issue' },
  { id: 'customer_unavailable', label: 'Customer Not Available at Location' },
  { id: 'wrong_address', label: 'Incorrect or Unreachable Address' },
  { id: 'safety_concern', label: 'Safety Concern at Location' },
  { id: 'other', label: 'Other Reason' },
] as const;

export const cancellationLabels = {
  title: 'Cancel Trip',
  subtitle: 'Please select a reason for cancellation:',
  confirmLabel: 'CONFIRM CANCELLATION',
  processingTitle: 'Processing Cancellation...',
  processingSubtitle: 'Please wait while we update your status.',
  successTitle: 'Trip Cancelled',
  successSubtitle: 'The trip has been cancelled successfully.',
  failureTitle: 'Cancellation Failed',
  failureSubtitle: 'Unable to process cancellation. Please try again.',
} as const;

// ───  ───

export const mockWalletBalance: WalletBalance = {
  balance: 2450.0,
  currency: '₹',
  minimumBalance: 500,
  isLowBalance: false,
};

export const mockTransactions: readonly Transaction[] = [
  {
    id: 'txn-001',
    type: 'credit',
    category: 'trip_earning',
    amount: 450.0,
    currency: '₹',
    title: 'Trip Earning',
    description: 'TRP-4821',
    date: 'Oct 24, 2023',
    time: '2:30 PM',
  },
  {
    id: 'txn-002',
    type: 'debit',
    category: 'platform_commission',
    amount: 67.5,
    currency: '₹',
    title: 'Platform Commission',
    description: '15% on TRP-4821',
    date: 'Oct 24, 2023',
    time: '2:30 PM',
  },
  {
    id: 'txn-003',
    type: 'credit',
    category: 'recharge',
    amount: 1000.0,
    currency: '₹',
    title: 'Wallet Recharge',
    description: 'HDFC Bank **** 1234',
    date: 'Oct 23, 2023',
    time: '10:15 AM',
  },
];

export const mockPaymentMethod: PaymentMethodInfo = {
  id: 'pm-001',
  type: 'bank_account',
  label: 'HDFC Bank',
  lastFourDigits: '1234',
  isDefault: true,
};

export const rechargePresets = [500, 1000, 2000, 5000] as const;

export const walletLabels = {
  walletTitle: 'Wallet',
  currentBalanceLabel: 'CURRENT BALANCE',
  rechargeTitle: 'Recharge Wallet',
  enterAmountLabel: 'Enter Amount',
  defaultPaymentLabel: 'Default Payment Method',
  continueLabel: 'Continue',
  processingTitle: 'Processing Recharge...',
  processingSubtitle: 'Please wait while we process your payment.',
  successTitle: 'Recharge Successful!',
  failureTitle: 'Recharge Failed',
  failureSubtitle: 'Unable to process payment. Please try again.',
  transactionHistoryTitle: 'Transaction History',
  lowBalanceWarning: 'Low Balance! Recharge to continue accepting trips.',
} as const;

// ───  ───

export const mockEarningsSummary: EarningsSummary = {
  period: 'today',
  totalEarnings: 1850,
  totalTrips: 8,
  currency: '₹',
  grossEarnings: 2200,
  platformCommission: 270,
  otherDeductions: 80,
  netEarnings: 1850,
  cashEarnings: 740,
  onlineEarnings: 1110,
  onlineHours: 6.2,
};

export const mockHistoricalTrip: HistoricalTrip = {
  id: 'LOG-9921',
  date: 'Oct 24, 2023',
  time: '10:30 AM',
  status: 'completed',
  stops: [
    { id: 's1', type: 'pickup', label: 'PICKUP', address: '124 Industrial Park, Sector 4', latitude: 0, longitude: 0, status: 'completed' },
    { id: 's2', type: 'drop', label: 'DROP 1', address: 'Wholesale Market', latitude: 0, longitude: 0, status: 'completed' },
    { id: 's3', type: 'drop', label: 'DROP 2', address: 'Retail Plaza', latitude: 0, longitude: 0, status: 'completed' },
    { id: 's4', type: 'drop_final', label: 'DROP 3 (FINAL)', address: 'Final Hub', latitude: 0, longitude: 0, status: 'completed' },
  ],
  loadType: 'electronics',
  goodsType: 'Electronic Appliances',
  totalWeight: '450 kg',
  vehicleType: 'Mini Truck',
  vehicleRegistration: 'LOG-9921',
  earnings: {
    tripId: 'LOG-9921',
    grossEarning: 1800,
    platformCommission: 270,
    platformCommissionPercent: 15,
    otherDeductions: 80,
    netEarning: 1450,
    currency: '₹',
    paidToWallet: true,
  },
};

export const earningsLabels = {
  earningsTitle: 'Earnings',
  todayTab: 'Today',
  weeklyTab: 'Weekly',
  monthlyTab: 'Monthly',
  grossEarningsLabel: 'Gross Earning',
  platformCommissionLabel: 'Platform Commission',
  otherDeductionsLabel: 'Other Deductions',
  netEarningsLabel: 'Net Earning',
  paidToWalletLabel: 'Paid to Wallet successfully',
  tripHistoryTitle: 'Trip History',
  tripDetailsTitle: 'Trip Details',
  routeLabel: 'Route',
  loadDetailsLabel: 'Load Details',
  financialsLabel: 'Financials',
  vehicleLabel: 'Vehicle',
  goodsTypeLabel: 'Goods Type',
  totalWeightLabel: 'Total Weight',
} as const;

// ───  ───

export const profileLabels = {
  profileTitle: 'Profile',
  completionLabel: 'Profile Completion',
  documentsLabel: 'Documents',
  subscriptionLabel: 'Subscription',
  accountSettingsLabel: 'Account Settings',
} as const;

// ───  ───

export const mockKycDocuments: readonly KycDocument[] = [
  { id: 'kyc-1', type: 'driving_license', label: 'Driving License', status: 'approved' },
  { id: 'kyc-2', type: 'aadhaar_card', label: 'Aadhaar Card', status: 'approved' },
  { id: 'kyc-3', type: 'pan_card', label: 'PAN Card', status: 'under_review' },
  { id: 'kyc-4', type: 'vehicle_rc', label: 'Vehicle RC', status: 'rejected', rejectionReason: 'Document is blurry or illegible. Please upload a clear photo ensuring all edges are visible.' },
  { id: 'kyc-5', type: 'insurance_policy', label: 'Insurance Policy', status: 'under_review' },
  { id: 'kyc-6', type: 'vehicle_photos', label: 'Vehicle Photographs', status: 'approved' },
];

export const kycLabels = {
  documentsTitle: 'KYC Documents',
  vehicleStatusTitle: 'VEHICLE STATUS',
  actionRequiredTitle: 'Action Required',
  actionRequiredSubtitle: 'One or more of your documents require attention before you can start accepting trips.',
  requiredDocumentsLabel: 'REQUIRED DOCUMENTS',
  resubmitLabel: 'RESUBMIT',
  rejectionReasonLabel: 'Reason for rejection',
  verificationNote: 'Verification usually takes up to 24 hours.',
} as const;

// ───  ───

export const mockSubscription: Subscription = {
  id: 'sub-001',
  planName: 'Driver Pro Plan',
  status: 'active',
  validFrom: 'Oct 1, 2023',
  validUntil: 'Nov 1, 2023',
  autoRenew: true,
  amount: 299,
  currency: '₹',
  billingCycle: 'monthly',
  benefits: [
    { id: 'b1', title: 'Trip Requests', description: 'Access to all trip requests', iconName: 'local_shipping' },
    { id: 'b2', title: 'Premium Routing', description: 'Optimized route suggestions', iconName: 'route' },
    { id: 'b3', title: 'Instant Earnings Transfer', description: 'Instant wallet credit', iconName: 'payments' },
  ],
};

export const subscriptionLabels = {
  subscriptionTitle: 'Subscription',
  activeLabel: 'ACTIVE',
  expiredLabel: 'EXPIRED',
  subscribeNowLabel: 'Subscribe Now',
  requiredTitle: 'Subscription Required',
  requiredSubtitle: 'Your driver subscription has expired or is inactive. You cannot receive new trip requests until you renew.',
  accessRestrictedLabel: 'Access Restricted',
  contactSupportLabel: 'CONTACT SUPPORT',
  reviewGuidelinesLabel: 'REVIEW GUIDELINES',
} as const;

// ───  ───

export const accountRestrictedData = {
  title: 'Account Restricted',
  subtitle: 'Your driver account is currently under review and temporarily blocked.',
  reviewDetailsTitle: 'Review Details',
  reasonLabel: 'Reason',
  reasonText: 'Quality standards manual verification required.',
  restrictedActionsLabel: 'Restricted Actions',
  restrictedActions: [
    'Unable to accept new trip offers',
    'Payouts temporarily paused',
  ],
  statusLabel: 'Status',
  statusText: 'Review in progress. Please check back in 24 hours.',
} as const;

// ───  ───

export const mockSettingsSections: readonly SettingsSection[] = [
  {
    title: 'Personal',
    items: [
      { id: 's1', label: 'Profile', iconName: 'person', hasChevron: true, route: 'Profile' },
      { id: 's2', label: 'Language', value: 'English', iconName: 'language', hasChevron: true, route: 'LanguageSelection' },
    ],
  },
  {
    title: 'Vehicle & Service',
    items: [
      { id: 's3', label: 'Vehicle Details', iconName: 'local_shipping', hasChevron: true, route: 'VehicleDocuments' },
      { id: 's4', label: 'KYC Documents', iconName: 'description', hasChevron: true, route: 'KYCDocuments' },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { id: 's5', label: 'Notifications', iconName: 'notifications', hasChevron: true },
      { id: 's6', label: 'Privacy', iconName: 'lock', hasChevron: true },
    ],
  },
  {
    title: 'Account',
    items: [
      { id: 's7', label: 'Subscription', iconName: 'card_membership', hasChevron: true, route: 'Subscription' },
      { id: 's8', label: 'Help & Support', iconName: 'help', hasChevron: true },
      { id: 's9', label: 'Logout', iconName: 'logout', hasChevron: false },
    ],
  },
];

// ───  ───

export const mockNotifications: readonly Notification[] = [
  {
    id: 'notif-1',
    title: 'New Trip Available',
    description: 'A new trip request is available near your location.',
    timestamp: '2 min ago',
    isRead: false,
    category: 'trip',
    iconName: 'local_shipping',
  },
  {
    id: 'notif-2',
    title: 'Wallet Recharged',
    description: '₹1,000 has been added to your wallet.',
    timestamp: '1 hour ago',
    isRead: true,
    category: 'wallet',
    iconName: 'account_balance_wallet',
  },
  {
    id: 'notif-3',
    title: 'Document Approved',
    description: 'Your driving license has been verified.',
    timestamp: 'Yesterday',
    isRead: true,
    category: 'account',
    iconName: 'verified',
  },
];

export const notificationLabels = {
  title: 'Notifications',
  clearAllLabel: 'Clear All',
  noNotificationsTitle: 'No Notifications',
  noNotificationsSubtitle: 'You\'re all caught up!',
} as const;

// ───  ───

export const mockChatMessages: readonly ChatMessage[] = [
  {
    id: 'msg-1',
    sender: 'system',
    text: 'Please confirm pickup at Dock 4',
    timestamp: '2:30 PM',
    status: 'read',
    
  },
  {
    id: 'msg-2',
    sender: 'driver',
    text: 'On my way, ETA 5 minutes',
    timestamp: '2:31 PM',
    status: 'delivered',
    
  },
  {
    id: 'msg-3',
    sender: 'driver',
    imageUrl: 'https://example.com/pickup-photo.jpg',
    timestamp: '2:35 PM',
    status: 'sent',
    
  },
];

export const chatLabels = {
  title: 'Trip Chat',
  inputPlaceholder: 'Type a message...',
  sendLabel: 'Send',
  retryLabel: 'Retry',
  uploadingLabel: 'Uploading...',
  failedLabel: 'Failed to send',
} as const;

// ───  ───

export const errorStateLabels = {
  gpsUnavailableTitle: 'GPS Unavailable',
  gpsUnavailableSubtitle: 'Unable to determine your location. Please enable GPS and try again.',
  enableGpsLabel: 'ENABLE GPS',

  locationPermissionTitle: 'Location Access Required',
  locationPermissionSubtitle: 'Pick Up needs access to your location to show nearby trip requests and support navigation.',
  grantPermissionLabel: 'GRANT PERMISSION',
  openSettingsLabel: 'OPEN SETTINGS',

  networkUnavailableTitle: 'Connection Lost',
  networkUnavailableSubtitle: 'Please check your internet connection and try again.',
  retryLabel: 'RETRY',

  searchingTripsTitle: 'Searching for Trips...',
  searchingTripsSubtitle: "We'll notify you as soon as a new offer is available.",
} as const;


