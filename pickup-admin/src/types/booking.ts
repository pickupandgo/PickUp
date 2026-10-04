export type BookingStatus = 
  | 'Pending' 
  | 'Searching Driver' 
  | 'Driver Assigned' 
  | 'Driver Arrived' 
  | 'Pickup Completed' 
  | 'In Transit' 
  | 'Partially Delivered' 
  | 'Completed' 
  | 'Cancelled';

export type PaymentMethod = 'UPI' | 'Cash at Pickup' | 'COD' | 'Wallet';
export type PaymentStatus = 'Pending' | 'Completed' | 'Failed' | 'Refunded';

export interface Receiver {
  name: string;
  phone: string;
}

export interface BookingLocation {
  address: string;
  landmark?: string;
  instructions?: string;
}

export interface BookingDrop {
  id: string;
  order: number;
  location: BookingLocation;
  receiver: Receiver;
  status: 'Pending' | 'Completed' | 'Skipped';
  completedAt?: string;
}

export interface LoadInformation {
  type: string;
  description: string;
  approxWeightKg?: number;
  declaredValue?: number;
  specialInstructions?: string;
}

export interface BookingInsurance {
  selected: boolean;
  provider?: string;
  premium?: number;
  referenceId?: string;
}

export interface BookingFare {
  baseFare: number;
  distanceCharge?: number;
  hourlyCharge?: number;
  multiDropFee?: number;
  trafficSurcharge?: number;
  weatherSurcharge?: number;
  insurancePremium?: number;
  totalFare: number;
  platformCommission?: number;
  driverEarnings?: number;
}

export interface BookingPayment {
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  referenceId?: string;
}

export interface CancellationInfo {
  status: string;
  cancelledBy: 'Admin' | 'Customer' | 'Driver';
  reason: string;
  charge: number;
  timestamp: string;
  adminNote?: string;
}

export interface BookingNote {
  id: string;
  text: string;
  addedBy: string;
  timestamp: string;
}

export interface BookingTimelineEvent {
  id: string;
  status: BookingStatus;
  timestamp: string;
  description?: string;
}

export interface Booking {
  id: string;
  bookingDate: string;
  status: BookingStatus;
  
  customerId: string;
  customerName: string;
  customerPhone: string;
  
  driverId?: string;
  driverName?: string;
  driverPhone?: string;
  
  vehicleId?: string;
  vehicleRegistrationNumber?: string;
  vehicleCategoryId: string;
  vehicleCategoryName: string;

  pickup: BookingLocation & { contactName?: string; contactPhone?: string };
  drops: BookingDrop[];
  
  load: LoadInformation;
  insurance: BookingInsurance;
  fare: BookingFare;
  payment: BookingPayment;
  
  cancellation?: CancellationInfo;
  notes: BookingNote[];
  timeline: BookingTimelineEvent[];

  deliveryProof?: {
    photoUrl?: string; // Placeholder string
    location?: string;
    timestamp?: string;
    dropId?: string;
  };
}
