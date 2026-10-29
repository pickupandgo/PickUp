import { z } from 'zod';

/**
 * The payment backend's internal API responses the engine relies on (raj_backend
 * InternalBookingResponse / InternalFareQuoteResponse). Loose objects: extra fields are ignored,
 * missing or mistyped ones make the response unreadable, and nothing is applied from it.
 */

export const paymentGateSchema = z.looseObject({
  stage: z.enum(['PICKUP', 'DROP']).nullable(),
  stopSequence: z.number().int().nullable(),
  paymentState: z.string(),
  amountPaise: z.number().int().nullable(),
  handoverAllowed: z.boolean(),
});
export type PaymentGate = z.infer<typeof paymentGateSchema>;

export const internalBookingSchema = z.looseObject({
  bookingId: z.uuid(),
  externalRef: z.string(),
  status: z.string(),
  paymentMethod: z.string(),
  paymentStatus: z.string(),
  paymentModel: z.string(),
  quoteId: z.uuid().nullable(),
  payablePaise: z.number().int(),
  stops: z.array(
    z.looseObject({
      sequence: z.number().int(),
      payablePaise: z.number().int(),
      status: z.string(),
    }),
  ),
  paymentGate: paymentGateSchema,
  cancellationReason: z.string().nullable(),
  trip: z
    .looseObject({
      tripId: z.uuid(),
      status: z.string(),
    })
    .nullable(),
});
export type InternalBooking = z.infer<typeof internalBookingSchema>;

const coordinate = {
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
};

export const internalFareQuoteSchema = z.looseObject({
  quoteId: z.uuid(),
  vehicleCategory: z.string().min(1).max(40),
  weightKg: z.number().positive(),
  pickup: z.looseObject(coordinate),
  distanceMeters: z.number().int().min(0),
  farePaise: z.number().int().min(0),
  taxPaise: z.number().int().min(0),
  payablePaise: z.number().int().min(0),
  currency: z.literal('INR'),
  drops: z
    .array(
      z.looseObject({
        sequence: z.number().int().min(1),
        ...coordinate,
        distanceMeters: z.number().int().min(0),
        payablePaise: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(25),
  expiresAt: z.iso.datetime(),
  redeemed: z.boolean(),
});
export type InternalFareQuote = z.infer<typeof internalFareQuoteSchema>;

/**
 * The backend's authoritative answer for an engine driver's Firebase subject. The engine never
 * recreates the KYC, vehicle or approval rules represented by this result.
 */
export const internalDriverEligibilitySchema = z.looseObject({
  driverId: z.uuid(),
  subject: z.string().min(1).max(128),
  eligible: z.boolean(),
  reasons: z.array(z.string().min(1).max(80)).max(32),
  vehicleId: z.uuid().nullable(),
  checkedAt: z.iso.datetime(),
});
export type InternalDriverEligibility = z.infer<
  typeof internalDriverEligibilitySchema
>;

/** The payment backend's error envelope: { error: { code, message, details? } }. */
export const errorEnvelopeSchema = z.looseObject({
  error: z.looseObject({
    code: z.string().min(1).max(60),
    message: z.string().max(500).optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
