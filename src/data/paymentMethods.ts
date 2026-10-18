import type { PaymentMethod } from '../api/types';

/**
 * The customer's payment options, review H: exactly two, with this exact copy. No prepaid /
 * pay-now. The money is collected by the driver (at pickup or at each delivery) and only the
 * payments backend is authoritative for whether anything was paid.
 */
export interface PaymentMethodOption {
  readonly id: PaymentMethod;
  readonly label: string;
  readonly description: string;
  readonly icon: 'local-atm' | 'payments';
}

export const PAYMENT_METHOD_OPTIONS: readonly PaymentMethodOption[] = [
  {
    id: 'PAY_AT_PICKUP',
    label: 'PAY AT PICKUP',
    description: 'Pay when the driver arrives at your pickup location.',
    icon: 'local-atm',
  },
  {
    id: 'PAY_AT_DELIVERY',
    label: 'PAY AT DELIVERY',
    description: 'Receiver pays when the driver arrives at the delivery location.',
    icon: 'payments',
  },
];
