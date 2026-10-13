/** Money helpers. The backend works in integer paise; the screens show rupees. */

export const PAISE_PER_RUPEE = 100;

/** Recharges are entered in whole rupees. */
export function rupeesToPaise(rupees: number): number {
  if (!Number.isSafeInteger(rupees) || rupees <= 0) {
    throw new RangeError('Amount must be a positive whole number of rupees');
  }
  return rupees * PAISE_PER_RUPEE;
}

export function paiseToRupees(paise: number): number {
  return paise / PAISE_PER_RUPEE;
}

/** "₹1,250" for whole rupees, "₹1,250.50" otherwise. */
export function formatRupees(rupees: number, symbol = '₹'): string {
  const hasPaise = Math.round(rupees * PAISE_PER_RUPEE) % PAISE_PER_RUPEE !== 0;
  return `${symbol}${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}
