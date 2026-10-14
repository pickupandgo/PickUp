/**
 * Splits a booking's platform fee across its drops, in proportion to each drop's fare, so that
 * a drop paid on its own (pay at delivery) carries exactly its part of the fee.
 *
 * Largest remainder, integer arithmetic only:
 *   1. every drop gets floor(fee x dropFare / bookingFare);
 *   2. the paise left over (fewer than the number of drops) go one each to the drops with the
 *      largest remainders; equal remainders go to the lower sequence first.
 *
 * The shares always add up exactly to the fee, each share is its exact proportional share
 * rounded down or up by less than one paisa, and the same input always gives the same split.
 * The database checks the same bounds at commit (check_booking_snapshot).
 */

export interface FeeAllocationStop {
  readonly sequence: number;
  readonly farePaise: bigint;
}

export class FeeAllocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeeAllocationError';
  }
}

/** The fee share of each stop, in the order the stops were given. */
export function allocatePlatformFee(
  feePaise: bigint,
  stops: readonly FeeAllocationStop[],
): bigint[] {
  if (stops.length === 0) {
    throw new FeeAllocationError('At least one stop is required');
  }
  const sequences = new Set<number>();
  let totalFare = 0n;
  for (const stop of stops) {
    if (!Number.isSafeInteger(stop.sequence) || stop.sequence < 1) {
      throw new FeeAllocationError('Stop sequences must be positive integers');
    }
    if (sequences.has(stop.sequence)) {
      throw new FeeAllocationError('Stop sequences must be unique');
    }
    sequences.add(stop.sequence);
    if (stop.farePaise <= 0n) {
      throw new FeeAllocationError('Every stop must have a positive fare');
    }
    totalFare += stop.farePaise;
  }
  if (feePaise < 0n || feePaise > totalFare) {
    throw new FeeAllocationError('The fee must be between zero and the total fare');
  }

  const parts = stops.map((stop, index) => {
    const exact = feePaise * stop.farePaise;
    return {
      index,
      sequence: stop.sequence,
      share: exact / totalFare,
      remainder: exact % totalFare,
    };
  });
  let leftover = feePaise - parts.reduce((sum, part) => sum + part.share, 0n);

  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.sequence - b.sequence : a.remainder > b.remainder ? -1 : 1,
  );
  for (const part of byRemainder) {
    if (leftover === 0n) {
      break;
    }
    part.share += 1n;
    leftover -= 1n;
  }

  return parts.map((part) => part.share);
}
