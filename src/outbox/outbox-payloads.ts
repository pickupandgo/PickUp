import { z } from 'zod';

/**
 * What each outbox record carries. The request is built at send time from these and the current
 * booking and trip rows (the payment trip id is known only once ASSIGN was delivered).
 */
export const ENGINE_TRIP_REPORTS = [
  'DRIVER_ARRIVED',
  'PICKUP_VERIFIED',
  'IN_TRANSIT',
  'COMPLETED',
] as const;
export type EngineTripReport = (typeof ENGINE_TRIP_REPORTS)[number];

export const ENGINE_STOP_REPORTS = [
  'ARRIVED',
  'DELIVERED',
  'DELIVERY_FAILED',
] as const;
export type EngineStopReport = (typeof ENGINE_STOP_REPORTS)[number];

export const searchingPayload = z.object({});
export const assignPayload = z.object({
  tripId: z.uuid(),
  driverSubject: z.string().min(1).max(128),
});
export const tripStatusPayload = z.object({
  tripId: z.uuid(),
  status: z.enum(ENGINE_TRIP_REPORTS),
});
export const stopStatusPayload = z.object({
  tripId: z.uuid(),
  sequence: z.number().int().min(1),
  status: z.enum(ENGINE_STOP_REPORTS),
  /** DELIVERY_FAILED only: sent to the backend. */
  reason: z.string().min(3).max(200).optional(),
  /** DELIVERED only: the delivery photo, kept by the engine when the backend accepts. */
  proofUri: z.string().min(1).max(1000).optional(),
});
export const cancelPayload = z.object({
  reason: z.string().min(3).max(200),
  cancelledBy: z.enum(['CUSTOMER', 'DRIVER', 'SYSTEM']),
});

export type AssignPayload = z.infer<typeof assignPayload>;
export type TripStatusPayload = z.infer<typeof tripStatusPayload>;
export type StopStatusPayload = z.infer<typeof stopStatusPayload>;
export type CancelPayload = z.infer<typeof cancelPayload>;

export type OutboxPayload =
  | { readonly kind: 'SEARCHING'; readonly payload: Record<string, never> }
  | { readonly kind: 'ASSIGN'; readonly payload: AssignPayload }
  | { readonly kind: 'TRIP_STATUS'; readonly payload: TripStatusPayload }
  | { readonly kind: 'STOP_STATUS'; readonly payload: StopStatusPayload }
  | { readonly kind: 'CANCEL'; readonly payload: CancelPayload };

/** Reads a stored payload back; a payload that no longer parses is a bug, never sent. */
export function readPayload(
  kind: string,
  payload: unknown,
): OutboxPayload | null {
  switch (kind) {
    case 'SEARCHING':
      return searchingPayload.safeParse(payload).success
        ? { kind, payload: {} }
        : null;
    case 'ASSIGN': {
      const parsed = assignPayload.safeParse(payload);
      return parsed.success ? { kind, payload: parsed.data } : null;
    }
    case 'TRIP_STATUS': {
      const parsed = tripStatusPayload.safeParse(payload);
      return parsed.success ? { kind, payload: parsed.data } : null;
    }
    case 'STOP_STATUS': {
      const parsed = stopStatusPayload.safeParse(payload);
      return parsed.success ? { kind, payload: parsed.data } : null;
    }
    case 'CANCEL': {
      const parsed = cancelPayload.safeParse(payload);
      return parsed.success ? { kind, payload: parsed.data } : null;
    }
    default:
      return null;
  }
}
