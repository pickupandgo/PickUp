/**
 * Mock data layer for the Pick Up Customer App.
 * All static text, image URIs, and list data is decoupled here.
 * Components MUST NOT contain hardcoded content strings.
 */

// ─── User ────────────────────────────────────────────────────────────────────

export const mockUser = {
  name: 'Sarah',
  fullName: 'Sarah Johnson',
  email: 'sarah.johnson@example.com',
  phone: '+91 98765 43210',
  age: '28',
  address: '123 Sardarpura Main Road, Sardarpura, Jodhpur, Rajasthan',
  avatarUrl: '',
  rating: 4.8,
} as const;

// ─── Addresses ───────────────────────────────────────────────────────────────

export interface Address {
  readonly id: string;
  readonly label: string;
  readonly type: 'home' | 'work' | 'other';
  readonly address: string;
  readonly icon: string;
}

export const mockSavedAddresses: readonly Address[] = [
  {
    id: '1',
    label: 'Home',
    type: 'home',
    address: '42 MG Road, Bangalore 560001',
    icon: 'home',
  },
  {
    id: '2',
    label: 'Office',
    type: 'work',
    address: 'Tower B, Prestige Tech Park, Bangalore',
    icon: 'work',
  },
  {
    id: '3',
    label: 'Gym',
    type: 'other',
    address: '15 Brigade Road, Bangalore 560025',
    icon: 'fitness_center',
  },
];

// ─── Vehicle Types ───────────────────────────────────────────────────────────

export interface VehicleType {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly capacity: string;
  readonly estimatedPrice: string;
  readonly eta: string;
  readonly icon: string;
}

export const mockVehicleTypes: readonly VehicleType[] = [
  {
    id: 'bike',
    name: 'Bike / 2-Wheeler',
    description: 'Quick delivery for small packages',
    capacity: 'Up to 20kg',
    estimatedPrice: 'Est. ₹50',
    eta: '15 min',
    icon: 'truck',
  },
  {
    id: '3-wheeler',
    name: '3-Wheeler / E-Loader',
    description: 'Medium packages, faster than truck',
    capacity: 'Up to 500kg',
    estimatedPrice: 'Est. ₹150',
    eta: '20 min',
    icon: 'truck',
  },
  {
    id: 'mini-truck',
    name: 'Mini Truck / Tata Ace',
    description: 'Large items and bulk delivery',
    capacity: 'Up to 850kg',
    estimatedPrice: 'Est. ₹250',
    eta: '30 min',
    icon: 'truck',
  },
  {
    id: 'pickup',
    name: 'Pickup / Bolero',
    description: 'Heavy and oversized items',
    capacity: 'Up to 1.5 Tons',
    estimatedPrice: 'Est. ₹400',
    eta: '45 min',
    icon: 'truck',
  },
  {
    id: 'jcb',
    name: 'JCB',
    description: 'Industrial Use',
    capacity: 'Industrial Use',
    estimatedPrice: 'Get Quote',
    eta: '',
    icon: 'settings',
  },
  {
    id: 'crane',
    name: 'Crane',
    description: 'Heavy Lifting',
    capacity: 'Heavy Lifting',
    estimatedPrice: 'Get Quote',
    eta: '',
    icon: 'settings',
  },
];

// ─── Active Trip ─────────────────────────────────────────────────────────────

export interface TripStop {
  readonly label: string;
  readonly address: string;
  readonly status: 'completed' | 'current' | 'upcoming';
  readonly contactName?: string;
}

export const mockActiveTrip = {
  id: 'TRIP-2847',
  status: 'In Transit' as const,
  driverName: 'Rajesh Kumar',
  driverRating: 4.9,
  driverPhone: '+91 98765 12345',
  vehicleNumber: 'KA 01 AB 1234',
  vehicleType: 'Mini Truck',
  otp: '4829',
  estimatedArrival: '12:45 PM',
  stops: [
    { label: 'Pickup', address: '42 MG Road, Bangalore', status: 'completed', contactName: 'Sender' },
    { label: 'Drop 1', address: 'HSR Layout, Bangalore', status: 'current', contactName: 'Receiver 1' },
    { label: 'Drop 2', address: 'Koramangala, Bangalore', status: 'upcoming' },
  ] as readonly TripStop[],
  fare: '₹349',
  distance: '12.5 km',
} as const;

// ─── Trip History ────────────────────────────────────────────────────────────

export interface TripHistoryItem {
  readonly id: string;
  readonly date: string;
  readonly from: string;
  readonly to: string;
  readonly amount: string;
  readonly status: 'completed' | 'cancelled';
  readonly vehicleType: string;
  /** Shown on completed trip cards. */
  readonly paymentMethod?: string;
  /** Shown on cancelled trip cards in place of the payment method. */
  readonly cancelReason?: string;
}

export const mockTrips = [
  {
    id: 'TRP-1002',
    date: '12 Oct, 2023',
    status: 'completed',
    from: 'Warehouse A, Industrial Area',
    to: 'Store B, Downtown',
    amount: '₹450',
    vehicleType: 'Mini Truck',
  },
];

export const mockRecentLocations = [
  { id: '1', name: 'Sardarpura Warehouse', address: 'Jodhpur, Rajasthan' },
  { id: '2', name: 'Ratanada Hub', address: 'Jodhpur, Rajasthan' },
  { id: '3', name: 'Paota Godown', address: 'Jodhpur, Rajasthan' },
];

export const mockTripHistory: readonly TripHistoryItem[] = [
  {
    id: 'TRIP-2846',
    date: 'Aug 24, 2026',
    from: 'Indiranagar',
    to: 'Whitefield',
    amount: '₹529',
    status: 'completed',
    vehicleType: 'Mini Truck',
    paymentMethod: 'UPI',
  },
  {
    id: 'TRIP-2845',
    date: 'Aug 22, 2026',
    from: 'Koramangala',
    to: 'Electronic City',
    amount: '₹199',
    status: 'completed',
    vehicleType: 'Auto',
    paymentMethod: 'Cash',
  },
  {
    id: 'TRIP-2844',
    date: 'Aug 20, 2026',
    from: 'MG Road',
    to: 'Marathahalli',
    amount: '₹89',
    status: 'cancelled',
    vehicleType: 'Bike',
    cancelReason: 'Cancelled by you',
  },
  {
    id: 'TRIP-2843',
    date: 'Aug 18, 2026',
    from: 'Jayanagar',
    to: 'Hebbal',
    amount: '₹749',
    status: 'completed',
    vehicleType: 'Truck',
    paymentMethod: 'UPI',
  },
];

// ─── Notifications ───────────────────────────────────────────────────────────

export interface NotificationItem {
  readonly id: string;
  readonly title: string;
  readonly message: string;
  readonly time: string;
  readonly read: boolean;
  readonly icon: string;
}

export const mockNotifications: readonly NotificationItem[] = [
  {
    id: '1',
    title: 'Delivery Completed',
    message: 'Your package to HSR Layout has been delivered successfully.',
    time: '2 min ago',
    read: false,
    icon: 'check_circle',
  },
  {
    id: '2',
    title: 'Driver Assigned',
    message: 'Rajesh Kumar has been assigned to your pickup request.',
    time: '15 min ago',
    read: false,
    icon: 'person',
  },
  {
    id: '3',
    title: 'Payment Received',
    message: 'Payment of ₹349 has been confirmed for TRIP-2846.',
    time: '1 hr ago',
    read: true,
    icon: 'payments',
  },
  {
    id: '4',
    title: 'Promo Available',
    message: 'Use code PICKUP20 for 20% off your next delivery!',
    time: '3 hrs ago',
    read: true,
    icon: 'local_offer',
  },
];

// ─── Payment Methods ─────────────────────────────────────────────────────────

export interface PaymentMethod {
  readonly id: string;
  readonly type: 'upi' | 'card' | 'cash';
  readonly label: string;
  readonly detail: string;
  readonly icon: string;
  readonly isDefault: boolean;
}

export const mockPaymentMethods: readonly PaymentMethod[] = [
  {
    id: '1',
    type: 'upi',
    label: 'Google Pay',
    detail: 'sarah@oksbi',
    icon: 'account_balance',
    isDefault: true,
  },
  {
    id: '2',
    type: 'card',
    label: 'Credit Card',
    detail: '•••• 4242',
    icon: 'credit_card',
    isDefault: false,
  },
  {
    id: '3',
    type: 'cash',
    label: 'Cash',
    detail: 'Pay on delivery',
    icon: 'payments',
    isDefault: false,
  },
];

// ─── Cancellation Reasons ────────────────────────────────────────────────────

export const mockCancellationReasons: readonly string[] = [
  'Driver is too far away',
  'Change of plans',
  'Found a better option',
  'Price is too high',
  'Incorrect pickup/drop location',
  'Other',
];

// ─── Booking Review Data ─────────────────────────────────────────────────────

export const mockBookingReview = {
  pickup: '42 MG Road, Bangalore',
  drops: ['HSR Layout, Bangalore', 'Koramangala, Bangalore'],
  vehicleType: 'Mini Truck',
  estimatedFare: '₹349',
  distance: '12.5 km',
  estimatedTime: '35 min',
  paymentMethod: 'Google Pay',
  declaredValue: '₹5,000',
  insurance: 'Basic Cover',
} as const;

// ─── Strings / Labels ────────────────────────────────────────────────────────

export const strings = {
  appName: 'Pick Up',
  login: {
    title: 'Welcome to Pick Up',
    subtitle: 'Your trusted logistics partner',
    phonePlaceholder: 'Enter mobile number',
    continueButton: 'Continue',
    termsPrefix: 'By continuing, you agree to our',
    termsLink: 'Terms & Conditions',
  },
  home: {
    greeting: 'Good morning',
    searchPlaceholder: 'Where do you want to send?',
    quickActions: 'Quick Actions',
    activeTrips: 'Active Trips',
    recentTrips: 'Recent Trips',
    recentLocations: 'RECENT LOCATIONS',
    startBooking: 'Start Booking',
    seeAll: 'See all',
  },
  booking: {
    selectVehicle: 'Select Vehicle',
    reviewBooking: 'Review Booking',
    fareEstimate: 'Fare Estimate',
    confirmBooking: 'Confirm Booking',
    declaredValue: 'Declared Value',
    goodsInsurance: 'Goods Insurance',
  },
  tracking: {
    liveTracking: 'Live Tracking',
    driverAssigned: 'Driver Assigned',
    driverFound: 'Driver Found',
    shareTracking: 'Share Tracking',
    findingDriver: 'Finding nearby driver...',
    callDriver: 'Call Driver',
    chat: 'Chat',
  },
  payment: {
    selectPayment: 'Select Payment Method',
    processing: 'Processing Payment...',
    successful: 'Payment Successful',
    failed: 'Payment Failed',
    pending: 'Payment Pending',
  },
  trip: {
    summary: 'Trip Summary',
    completed: 'Trip Completed',
    cancelled: 'Trip Cancelled',
    history: 'Trip History',
    details: 'Trip Details',
    writeReview: 'Write a Review',
  },
  permissions: {
    locationTitle: 'Enable Location',
    locationSubtitle: 'We need your location to find nearby drivers and show accurate pickup points.',
    notificationTitle: 'Enable Notifications',
    notificationSubtitle: 'Stay updated on your delivery status and driver arrival.',
    cameraTitle: 'Allow Camera Access',
    cameraSubtitle: 'Take photos for delivery verification and proof of pickup.',
    allow: 'Allow',
    notNow: 'Not Now',
  },
  errors: {
    noInternet: 'No Internet Connection',
    noInternetMessage: 'Please check your connection and try again.',
    serverUnavailable: 'Server Unavailable',
    serverUnavailableMessage: 'We\'re working on it. Please try again later.',
    connectionLost: 'Connection Lost',
    connectionLostMessage: 'Attempting to reconnect...',
    retry: 'Retry',
    goBack: 'Go Back',
  },
  profile: {
    title: 'Profile',
    editProfile: 'Edit Profile',
    savedAddresses: 'Saved Addresses',
    paymentMethods: 'Payment Methods',
    notifications: 'Notifications',
    helpSupport: 'Help & Support',
    about: 'About',
    logout: 'Log Out',
    logoutConfirmTitle: 'Log Out?',
    logoutConfirmMessage: 'Are you sure you want to log out?',
    cancel: 'Cancel',
    confirm: 'Log Out',
  },
} as const;
