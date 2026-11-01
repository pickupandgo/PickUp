import type { CustomerBooking } from '../api/types';
export const formatPaise = (value: number | undefined): string =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? `\u20b9${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}` : 'Not available';
export const paymentLabel = (booking?: CustomerBooking): string => {
  if (!booking) return 'Payment status unavailable';
  const status: Record<string, string> = { PAID: 'Paid', PARTIALLY_PAID: 'Partially paid', REFUND_PENDING: 'Refund pending', REFUNDED: 'Refunded', PARTIALLY_REFUNDED: 'Partially refunded' };
  if (status[booking.paymentStatus]) return status[booking.paymentStatus];
  if (booking.paymentGate?.paymentState === 'PAYMENT_PROCESSING') return 'Payment processing';
  if (booking.paymentGate?.paymentState === 'PAYMENT_FAILED') return 'Payment failed';
  return booking.paymentStatus === 'UNPAID' ? 'Payment pending' : 'Payment status unavailable';
};
