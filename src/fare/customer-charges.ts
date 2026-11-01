import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { divideHalfUp } from '../common/money';
import { MAX_PAYABLE_PAISE, type PricedQuote } from './fare-pricer';
/** Customer surcharge only; the driver's settlement commission is independent. */
export function applyCustomerCharges(priced: PricedQuote, basisPoints: number): PricedQuote {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10000)
    throw new RangeError('Invalid customer platform fee basis points');
  if (priced.deliveryFarePaise !== undefined) throw new Error('Customer charges already applied');
  const deliveryFarePaise = priced.farePaise;
  if (deliveryFarePaise <= 0n) throw new RangeError('Delivery fare must be positive');
  const fee = divideHalfUp(deliveryFarePaise * BigInt(basisPoints), 10000n);
  const farePaise = deliveryFarePaise + fee;
  const payablePaise = farePaise + priced.taxPaise;
  if (payablePaise > MAX_PAYABLE_PAISE)
    throw new AppError(
      ErrorCode.AMOUNT_OUT_OF_RANGE,
      HttpStatus.UNPROCESSABLE_ENTITY,
      'The total including platform fee exceeds the payable limit',
    );
  let cumulative = 0n,
    allocated = 0n;
  const drops = priced.drops.map((drop) => {
    cumulative += drop.farePaise;
    const throughThisStop = divideHalfUp(cumulative * fee, deliveryFarePaise);
    const share = throughThisStop - allocated;
    allocated = throughThisStop;
    return { ...drop, farePaise: drop.farePaise + share, payablePaise: drop.payablePaise + share };
  });
  if (
    allocated !== fee ||
    drops.reduce((sum, drop) => sum + drop.payablePaise, 0n) !== payablePaise
  )
    throw new Error('Customer charge allocation did not reconcile');
  return {
    ...priced,
    drops,
    deliveryFarePaise,
    customerPlatformFeePaise: fee,
    customerPlatformFeeBps: basisPoints,
    surgeChargePaise: 0n,
    farePaise,
    payablePaise,
  };
}
