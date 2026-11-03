import type { EarningDto } from '../services/payments/earningsDto';

export type TripHistoryFilter = 'all' | 'completed' | 'cancelled';
export interface HistoryStop {
  readonly id: string;
  readonly sequence: number;
  readonly address: string | null;
  readonly status: string;
  readonly arrivedAt?: string | null;
  readonly deliveredAt?: string | null;
  readonly failedAt?: string | null;
  /** Confirmed drop proof metadata only. Raw file paths/storage URLs are never retained. */
  readonly deliveryPhoto?: { readonly availability: 'DEVICE_ONLY' | 'PREVIEW_UNAVAILABLE'; readonly submittedAt: string | null } | null;
}
export interface TripHistoryRecord {
  readonly id: string;
  readonly reference: string;
  readonly driverId: string;
  readonly paymentTripId: string | null;
  readonly paymentBookingId: string | null;
  /** Raw engine status: never inferred from an earning/payment. */
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  /** Booking's historical category. The API does not expose the actual vehicle snapshot. */
  readonly vehicleCategory: string | null;
  readonly pickupAddress: string | null;
  readonly stops: readonly HistoryStop[];
  readonly cancellationReason: string | null;
  readonly distanceKm: number | null;
  readonly weightKg: number | null;
  readonly timeline: readonly { label: string; at: string }[];
  readonly earning: EarningDto | null;
}
export interface TripHistoryCounts { all: number; completed: number; cancelled: number }
export interface TripHistorySnapshot {
  readonly items: readonly TripHistoryRecord[];
  /** Null when the server's fixed 50-row window may omit older records. */
  readonly counts: TripHistoryCounts | null;
  readonly truncated: boolean;
}
