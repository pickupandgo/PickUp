// ============================================================
// PICK UP ADMIN PANEL — CUSTOMER TYPES
// ============================================================

export type CustomerStatus = 'active' | 'blocked';
export type PaymentStatus = 'clear' | 'outstanding' | 'suspended';

export interface Customer {
  id: string;              // e.g. CUST-001
  name: string;
  phone: string;
  email?: string;
  registeredAt: string;   // ISO date string
  status: CustomerStatus;
  paymentStatus: PaymentStatus;
  totalBookings: number;
  completedTrips: number;
  cancelledTrips: number;
  totalSpent: number;     // INR
  city: string;
  notes: InternalNote[];
  bookingHistory: CustomerBookingRecord[];
}

export interface InternalNote {
  id: string;
  text: string;
  addedBy: string;        // admin name
  addedAt: string;        // ISO date string
}

export interface CustomerBookingRecord {
  bookingId: string;
  date: string;
  pickupAddress: string;
  dropSummary: string;
  vehicleCategory: string;
  amount: number;
  status: 'completed' | 'cancelled' | 'in_progress';
}

// Service-level filter shape
export interface CustomerFilters {
  search: string;
  status: CustomerStatus | 'all';
  paymentStatus: PaymentStatus | 'all';
}
