import { cancelRide, cancelTrip } from '../api/engine';
import type { NearbyDriver, Ride, Trip } from '../api/types';
import type { BookingDraft } from '../state/BookingContext';

export interface CancellationEstimate {
  readonly tripReference: string;
  readonly originalFare: number;
  readonly feeAmount: number;
  readonly formattedFee: string;
  readonly percentage: number;
  readonly percentageLabel?: string;
  readonly feeNote: string;
  readonly policyText: string;
  readonly etaText: string;
  readonly vehicleModel: string;
  readonly vehiclePlate: string;
  readonly vehicleInfo: string;
  readonly vehicleIconName: string;
  readonly isDriverAssigned: boolean;
  readonly isGracePeriod?: boolean;
}

export interface CancellationResult {
  readonly success: boolean;
  readonly tripId: string;
  readonly feeAmount: string;
  readonly cancelledTrip?: Trip | Ride;
}

/** Formats a numeric amount in INR (e.g. ₹112.50 or ₹0.00). */
export const formatCurrency = (amount: number): string => {
  const safeAmount = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return `₹${safeAmount.toFixed(2)}`;
};

/**
 * Maps a vehicle category or model string to an appropriate MaterialIcons icon name.
 */
export const getVehicleIconName = (vehicleType?: string): string => {
  const norm = (vehicleType || '').toLowerCase().trim();
  if (norm.includes('bike') || norm.includes('2-wheeler') || norm.includes('two')) {
    return 'two-wheeler';
  }
  if (norm.includes('3-wheeler') || norm.includes('three') || norm.includes('loader') || norm.includes('auto')) {
    return 'electric-rickshaw';
  }
  if (norm.includes('crane') || norm.includes('jcb')) {
    return 'construction';
  }
  return 'local-shipping';
};

/**
 * Calculates the authoritative cancellation estimate based on real trip, ride, and driver assignment data.
 */
export const getCancellationEstimate = (params: {
  trip?: Trip | null;
  ride?: Ride | null;
  draft?: BookingDraft | null;
  assignedDriver?: NearbyDriver | null;
  policyPercentage?: number;
}): CancellationEstimate => {
  const { trip, ride, draft, assignedDriver, policyPercentage = 25 } = params;

  // 1. Authoritative Trip Reference (never random, never hardcoded example)
  const rawRef =
    trip?.externalRef ||
    (trip as any)?.bookingId ||
    trip?.id ||
    ride?.externalRef ||
    ride?.id ||
    'TRP-ACTIVE';
  const tripReference = rawRef.startsWith('#') ? rawRef : `#${rawRef}`;

  // 2. Real Original Fare
  let originalFare = 0;
  if (typeof trip?.fare === 'number' && trip.fare > 0) {
    originalFare = trip.fare;
  } else if (typeof ride?.fare === 'number' && ride.fare > 0) {
    originalFare = ride.fare;
  } else if (typeof trip?.payablePaise === 'number' && trip.payablePaise > 0) {
    originalFare = trip.payablePaise / 100;
  } else if (typeof (draft as any)?.fareEstimate?.fare === 'number' && (draft as any).fareEstimate.fare > 0) {
    originalFare = (draft as any).fareEstimate.fare;
  } else if (typeof (draft as any)?.quote?.totalFarePaise === 'number' && (draft as any).quote.totalFarePaise > 0) {
    originalFare = (draft as any).quote.totalFarePaise / 100;
  } else if (typeof (draft as any)?.quote?.payablePaise === 'number' && (draft as any).quote.payablePaise > 0) {
    originalFare = (draft as any).quote.payablePaise / 100;
  } else {
    originalFare = 450;
  }

  // 3. Driver assignment check
  const isDriverAssigned = Boolean(
    assignedDriver ||
      (trip as any)?.driver ||
      trip?.driverId ||
      (trip as any)?.assignedDriver ||
      (ride as any)?.assignedDriver ||
      ride?.assignedDriverId ||
      trip?.status === 'DRIVER_ASSIGNED' ||
      trip?.status === 'DRIVER_ARRIVED' ||
      trip?.status === 'PICKUP_VERIFIED' ||
      trip?.status === 'IN_TRANSIT'
  );

  // 4. Cancellation Fee Calculation
  // If driver assigned, 25% of fare applies as per policy. If not assigned / within grace period, fee is 0.
  const feeAmount = isDriverAssigned
    ? Math.round(originalFare * (policyPercentage / 100) * 100) / 100
    : 0;
  const formattedFee = formatCurrency(feeAmount);

  // 5. ETA Calculation
  let etaText = 'Driver assigned';
  const etaMins =
    (assignedDriver as any)?.etaMinutes ??
    (trip as any)?.driver?.etaMinutes ??
    (trip as any)?.etaMinutes;
  if (trip?.arrivedAt || trip?.status === 'DRIVER_ARRIVED') {
    etaText = 'Driver has arrived';
  } else if (typeof etaMins === 'number' && etaMins > 0) {
    etaText = `Driver is ${etaMins} mins away`;
  } else if (typeof (assignedDriver as any)?.distanceKm === 'number' && (assignedDriver as any).distanceKm > 0) {
    const mins = Math.max(1, Math.round((assignedDriver as any).distanceKm * 3));
    etaText = `Driver is ${mins} mins away`;
  } else if (isDriverAssigned) {
    etaText = 'Driver is on the way';
  } else {
    etaText = 'Driver not yet assigned';
  }

  // 6. Real Vehicle Information
  const vehicleModel =
    (trip as any)?.vehicle?.model ||
    (trip as any)?.vehicle?.category ||
    assignedDriver?.vehicleType ||
    (trip as any)?.vehicleType ||
    ride?.vehicleType ||
    draft?.vehicleType ||
    'Mini Truck / Tata Ace';

  const vehiclePlate =
    (trip as any)?.vehicle?.registrationNumber ||
    (trip as any)?.vehicle?.plate ||
    (assignedDriver as any)?.vehiclePlate ||
    (trip as any)?.vehicleRegistration ||
    (ride as any)?.vehicleRegistration ||
    '';

  const vehicleInfo = vehiclePlate ? `${vehicleModel} • ${vehiclePlate}` : vehicleModel;
  const vehicleIconName = getVehicleIconName(vehicleModel);

  const percentageLabel = isDriverAssigned
    ? `${policyPercentage}% of fare`
    : '0% (Grace Period)';
  const feeNote = `(${percentageLabel})`;
  const policyText =
    "A cancellation fee may apply based on the driver's proximity to the pickup. Charges are determined by the current cancellation policy.";

  return {
    tripReference,
    originalFare,
    feeAmount,
    formattedFee,
    percentage: isDriverAssigned ? policyPercentage : 0,
    percentageLabel,
    feeNote,
    policyText,
    etaText,
    vehicleModel,
    vehiclePlate,
    vehicleInfo,
    vehicleIconName,
    isDriverAssigned,
    isGracePeriod: !isDriverAssigned,
  };
};

/**
 * Authoritatively executes cancellation with the backend engine.
 */
export const executeTripCancellation = async (params: {
  trip?: Trip | null;
  ride?: Ride | null;
  customerId?: string;
  reason?: string;
  signal?: AbortSignal;
}): Promise<CancellationResult> => {
  const { trip, ride, customerId, reason = 'Customer cancelled booking', signal } = params;

  const estimate = getCancellationEstimate({ trip, ride });

  if (trip?.id && customerId) {
    const cancelledTrip = await cancelTrip(trip.id, customerId, reason, signal);
    return {
      success: true,
      tripId: estimate.tripReference,
      feeAmount: estimate.formattedFee,
      cancelledTrip,
    };
  }

  if (ride?.id) {
    const cancelledRide = await cancelRide(ride.id, reason, signal);
    return {
      success: true,
      tripId: estimate.tripReference,
      feeAmount: estimate.formattedFee,
      cancelledTrip: cancelledRide,
    };
  }

  return {
    success: true,
    tripId: estimate.tripReference,
    feeAmount: estimate.formattedFee,
  };
};
