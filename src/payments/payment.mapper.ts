import { paiseToNumber } from '../common/money';
import type { Payment } from '../generated/prisma/client';
import type { AdminPaymentResponse, BookingPaymentResponse, TopUpResponse } from './payments.dto';

export function toTopUpResponse(payment: Payment, keyId: string): TopUpResponse {
  const amountPaise = paiseToNumber(payment.amountPaise);
  return {
    paymentId: payment.id,
    status: payment.status,
    amountPaise,
    currency: 'INR',
    checkout:
      payment.status === 'PENDING' && payment.razorpayOrderId
        ? { keyId, orderId: payment.razorpayOrderId, amountPaise, currency: 'INR' }
        : null,
    providerPaymentId: payment.razorpayPaymentId,
    paymentMethod: payment.paymentMethod,
    createdAt: payment.createdAt.toISOString(),
    updatedAt: payment.updatedAt.toISOString(),
  };
}

export function toAdminPaymentResponse(payment: Payment, keyId: string): AdminPaymentResponse {
  return {
    ...toTopUpResponse(payment, keyId),
    userId: payment.userId,
    purpose: payment.purpose,
    bookingId: payment.bookingId,
    razorpayOrderId: payment.razorpayOrderId,
  };
}

export function toBookingPaymentResponse(payment: Payment, keyId: string): BookingPaymentResponse {
  if (!payment.bookingId) {
    throw new Error('Not a booking payment');
  }
  return { ...toTopUpResponse(payment, keyId), bookingId: payment.bookingId };
}
