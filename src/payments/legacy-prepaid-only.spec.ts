import type { Principal } from '../auth/principal';
import type { AppConfig } from '../config/app-config';
import type { Booking, Payment } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { RazorpayGateway } from '../razorpay/razorpay.gateway';
import type { RazorpayPayment } from '../razorpay/razorpay.types';
import { BookingPaymentFinalizerService } from './booking-payment-finalizer.service';
import { BookingPaymentService } from './booking-payment.service';
import { PaymentConfirmationService } from './payment-confirmation.service';
import type { PaymentOrderService } from './payment-orders.service';
import type { TopUpFinalizerService } from './top-up-finalizer.service';

/*
 * In-app payment (Razorpay Checkout) exists only for historical PREPAID_UPI bookings (decision
 * N4). The database refuses every other booking payment row, so with real data these paths only
 * ever see historical prepaid bookings. Here they get bookings the database would never hold a
 * payment for, including QUOTE_PER_STOP + PREPAID_UPI (which a CHECK forbids outright), to prove
 * the code refuses them on its own: start, verify, capture and finalize.
 */

const BOOKING_ID = '6f1c2a51-6d0b-4c47-9f39-1d7e3b0c2a10';
const CUSTOMER_ID = 'c0a8012e-1f8e-4d0a-8c8f-3b2a1d0e9f87';

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: BOOKING_ID,
    externalRef: 'ENG-UNIT-1',
    customerId: CUSTOMER_ID,
    status: 'DRIVER_ASSIGNED',
    paymentStatus: 'UNPAID',
    paymentMethod: 'PREPAID_UPI',
    paymentModel: 'LEGACY_BOOKING_LEVEL',
    fareEstimateMinor: 50_000n,
    finalFareMinor: 50_000n,
    fareQuoteId: null,
    pricingVersionId: null,
    farePaise: null,
    taxPaise: null,
    platformFeePaise: null,
    ...overrides,
  } as Booking;
}

/** Bookings that must never be paid in the app. */
const NOT_HISTORICAL_PREPAID: [string, Partial<Booking>][] = [
  ['a quote booking marked PREPAID_UPI', { paymentModel: 'QUOTE_PER_STOP' }],
  [
    'a quote booking paid at pickup',
    { paymentModel: 'QUOTE_PER_STOP', paymentMethod: 'PAY_AT_PICKUP' },
  ],
  ['a historical pay-at-delivery booking', { paymentMethod: 'PAY_AT_DELIVERY' }],
];

const principal = {
  userId: 'user-1',
  role: 'CUSTOMER',
  driver: null,
  customer: { id: CUSTOMER_ID },
  session: { authenticatedAt: null, signInProvider: 'phone', phoneNumber: null },
} as Principal;

describe('BookingPaymentService: Checkout only for historical PREPAID_UPI bookings', () => {
  function serviceFor(row: Booking) {
    const prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue({ ...row, trip: null }) },
      payment: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: 'payment-1',
          amountPaise: row.finalFareMinor,
          razorpayOrderId: 'order_UnitTest0001',
          status: 'PENDING',
        }),
      },
    };
    const orders = { ensureOrder: jest.fn() };
    const confirmation = { confirm: jest.fn() };
    const service = new BookingPaymentService(
      prisma as unknown as PrismaService,
      orders as unknown as PaymentOrderService,
      confirmation as unknown as PaymentConfirmationService,
      { razorpay: { keySecret: 'unit_test_key_secret' } } as unknown as AppConfig,
    );
    return { service, prisma, confirmation };
  }

  it.each(NOT_HISTORICAL_PREPAID)('refuses to start or verify %s', async (_label, overrides) => {
    const { service, prisma, confirmation } = serviceFor(booking(overrides));
    await expect(service.start(principal, BOOKING_ID, 'idem-1')).rejects.toMatchObject({
      code: 'BOOKING_NOT_PAYABLE',
      status: 409,
    });
    await expect(
      service.verify(principal, BOOKING_ID, {
        razorpayOrderId: 'order_UnitTest0001',
        razorpayPaymentId: 'pay_UnitTest0001',
        razorpaySignature: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'BOOKING_NOT_PAYABLE', status: 409 });
    // Refused before any payment row is read or written.
    expect(prisma.payment.findFirst).not.toHaveBeenCalled();
    expect(prisma.payment.create).not.toHaveBeenCalled();
    expect(confirmation.confirm).not.toHaveBeenCalled();
  });

  it('starts the payment of a historical PREPAID_UPI booking (control)', async () => {
    const { service, prisma } = serviceFor(booking());
    await expect(service.start(principal, BOOKING_ID, 'idem-1')).resolves.toMatchObject({
      razorpayOrderId: 'order_UnitTest0001',
    });
    expect(prisma.payment.create).toHaveBeenCalledTimes(1);
  });
});

describe('PaymentConfirmationService: never captures for a booking that is not historical prepaid', () => {
  const authorized: RazorpayPayment = {
    id: 'pay_UnitTest0001',
    amount: 50_000,
    currency: 'INR',
    status: 'authorized',
    orderId: 'order_UnitTest0001',
    method: 'upi',
  };

  function serviceFor(row: Booking) {
    const payment = {
      id: 'payment-1',
      purpose: 'BOOKING',
      bookingId: BOOKING_ID,
      status: 'PENDING',
      razorpayOrderId: 'order_UnitTest0001',
      razorpayPaymentId: null,
      amountPaise: 50_000n,
      currency: 'INR',
    } as Payment;
    const prisma = {
      payment: { findUniqueOrThrow: jest.fn().mockResolvedValue(payment) },
      booking: {
        findUnique: jest.fn().mockResolvedValue({
          status: row.status,
          paymentStatus: row.paymentStatus,
          paymentMethod: row.paymentMethod,
          paymentModel: row.paymentModel,
        }),
      },
    };
    const gateway = {
      capturePayment: jest.fn().mockResolvedValue({ ...authorized, status: 'captured' }),
      fetchPayment: jest.fn(),
    };
    const finalizer = { finalizeCapturedBookingPayment: jest.fn().mockResolvedValue('APPLIED') };
    const service = new PaymentConfirmationService(
      prisma as unknown as PrismaService,
      gateway as unknown as RazorpayGateway,
      {} as TopUpFinalizerService,
      finalizer as unknown as BookingPaymentFinalizerService,
    );
    return { service, gateway, finalizer };
  }

  it.each(NOT_HISTORICAL_PREPAID)(
    'leaves an authorized payment uncaptured for %s',
    async (_label, overrides) => {
      const { service, gateway, finalizer } = serviceFor(booking(overrides));
      await expect(
        service.confirm('payment-1', authorized.id, {
          source: 'WEBHOOK',
          knownPayment: authorized,
        }),
      ).resolves.toMatchObject({ outcome: 'BOOKING_NOT_PAYABLE' });
      expect(gateway.capturePayment).not.toHaveBeenCalled();
      expect(finalizer.finalizeCapturedBookingPayment).not.toHaveBeenCalled();
    },
  );

  it('captures and applies it for a historical PREPAID_UPI booking (control)', async () => {
    const { service, gateway, finalizer } = serviceFor(booking());
    await expect(
      service.confirm('payment-1', authorized.id, { source: 'WEBHOOK', knownPayment: authorized }),
    ).resolves.toMatchObject({ outcome: 'APPLIED' });
    expect(gateway.capturePayment).toHaveBeenCalledWith(authorized.id, 50_000);
    expect(finalizer.finalizeCapturedBookingPayment).toHaveBeenCalledTimes(1);
  });
});

describe('BookingPaymentFinalizerService: never marks a booking that is not historical prepaid paid', () => {
  const captured: RazorpayPayment = {
    id: 'pay_UnitTest0001',
    amount: 50_000,
    currency: 'INR',
    status: 'captured',
    orderId: 'order_UnitTest0001',
    method: 'upi',
  };

  function finalizerFor(row: Booking) {
    const tx = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (sql.includes('FROM bookings')) {
          return Promise.resolve([{ id: row.id }]);
        }
        if (sql.includes('FROM trips')) {
          return Promise.resolve([]);
        }
        if (sql.includes('FROM payments')) {
          return Promise.resolve([
            {
              id: 'payment-1',
              status: 'PENDING',
              amount_paise: 50_000n,
              currency: 'INR',
              razorpay_order_id: 'order_UnitTest0001',
              razorpay_payment_id: null,
            },
          ]);
        }
        return Promise.reject(new Error(`unexpected query: ${sql}`));
      }),
      booking: { findUniqueOrThrow: jest.fn().mockResolvedValue(row), update: jest.fn() },
      trip: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      payment: { update: jest.fn() },
    };
    const prisma = {
      payment: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ purpose: 'BOOKING', bookingId: row.id }),
      },
      runInTransaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    return {
      tx,
      finalizer: new BookingPaymentFinalizerService(prisma as unknown as PrismaService),
    };
  }

  it.each(NOT_HISTORICAL_PREPAID)('refuses %s', async (_label, overrides) => {
    const { tx, finalizer } = finalizerFor(booking(overrides));
    await expect(
      finalizer.finalizeCapturedBookingPayment('payment-1', captured, { source: 'WEBHOOK' }),
    ).resolves.toBe('BOOKING_NOT_PAYABLE');
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it('applies a captured payment to a historical PREPAID_UPI booking (control)', async () => {
    const { tx, finalizer } = finalizerFor(booking());
    await expect(
      finalizer.finalizeCapturedBookingPayment('payment-1', captured, { source: 'WEBHOOK' }),
    ).resolves.toBe('APPLIED');
    expect(tx.payment.update).toHaveBeenCalledTimes(1);
    expect(tx.booking.update).toHaveBeenCalledWith({
      where: { id: BOOKING_ID },
      data: { paymentStatus: 'PAID' },
    });
  });
});
