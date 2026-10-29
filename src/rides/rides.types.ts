import { z } from 'zod';

const receiverSchema = z.strictObject({
  name: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(20).optional(),
});

/**
 * Details of a drop the customer adds to the priced route: who receives it and where exactly.
 * Coordinates are optional; when sent they must be the quote's (the route itself is the quote).
 */
const dropDetailSchema = z.strictObject({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  address: z.string().trim().max(300).optional(),
  receiver: receiverSchema.optional(),
});

const pickupDetailSchema = z.strictObject({
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  address: z.string().trim().max(300).optional(),
});

/**
 * POST /rides. The customer confirms a fare quote of the payment backend (POST /v1/fare/quotes
 * there). There is no fare, weight, vehicle or route here: all of them come from the quote. The
 * customer is the signed-in user, never a body field. Driver selection is exclusively the
 * engine's dispatch responsibility; a legacy `driverId`, if supplied by an older client, is
 * deliberately ignored by the service.
 */
export const createRideSchema = z.strictObject({
  quoteId: z.uuid({
    message: 'quoteId must be the payment backend fare quote id',
  }),
  paymentMethod: z.enum(['PAY_AT_PICKUP', 'PAY_AT_DELIVERY']),
  /** Legacy compatibility only. The engine never reads this value for dispatch. */
  driverId: z.string().min(1).max(128).optional(),
  /** Compatibility only: if sent, it must be the signed-in customer. */
  customerId: z.string().max(128).optional(),
  pickup: pickupDetailSchema.optional(),
  drops: z.array(dropDetailSchema).min(1).max(25).optional(),
  /** Single drop (older apps). */
  drop: dropDetailSchema.optional(),
});
export type CreateRideRequest = z.infer<typeof createRideSchema>;
export type DropDetail = z.infer<typeof dropDetailSchema>;

/** Amount fields a client may try to send. Refused explicitly: the quote is the only fare. */
export const CLIENT_AMOUNT_FIELDS = [
  'fare',
  'farePaise',
  'amount',
  'amountPaise',
  'payablePaise',
  'taxPaise',
  'platformFeePaise',
  'price',
  'confirmedFarePaise',
] as const;

export const driverActionSchema = z.strictObject({
  /** Compatibility only: if sent, it must be the signed-in driver. */
  driverId: z.string().max(128).optional(),
});

export const cancelRideSchema = z.strictObject({
  customerId: z.string().max(128).optional(),
  /** Why (3-200 characters): sent to the payment backend with the cancellation. */
  reason: z.string().trim().min(3).max(200),
});

/**
 * Status of a ride as the apps have always read it, plus the detail behind it:
 *   PENDING_REGISTRATION  the payment backend has not confirmed the booking yet (retry)
 *   REGISTRATION_FAILED   the payment backend refused it (registrationError says why)
 *   REQUESTED             offered to a driver, waiting for the answer
 *   REJECTED              the last offer was rejected, expired or refused; offer it again
 *   ACCEPTED              a driver accepted: the trip exists
 *   CANCELLED
 */
export type RideStatus =
  | 'PENDING_REGISTRATION'
  | 'REGISTRATION_FAILED'
  | 'REQUESTED'
  | 'REJECTED'
  | 'ACCEPTED'
  | 'CANCELLED';
