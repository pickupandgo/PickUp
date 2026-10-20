import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import type { Tx } from '../prisma/prisma.service';
import { quoteNotFound } from './fare-quotes.service';

/*
 * The Fare module's public contract. Payment code (bookings, payments, collections, earnings,
 * payouts, ...) may import this file and FareModule, nothing else from src/fare: it never sees a
 * pricing rule and never calculates a fare. It receives the frozen amounts of a quote and copies
 * them. An ESLint rule enforces the boundary.
 */

/** One drop's frozen amounts, in paise. */
export interface FrozenFareStop {
  /** The quoted drop's id; the booking's stop references it so its amounts can be checked. */
  readonly quoteStopId: string;
  readonly sequence: number;
  readonly farePaise: bigint;
  readonly taxPaise: bigint;
  readonly payablePaise: bigint;
}

/** Everything a booking needs from its quote. Amounts are integer paise; stops add up. */
export interface FrozenFare {
  readonly quoteId: string;
  readonly customerId: string;
  readonly pricingVersionId: string;
  readonly pricingVersionCode: string;
  readonly vehicleCategory: string;
  readonly weightGrams: number;
  readonly farePaise: bigint;
  readonly taxPaise: bigint;
  readonly payablePaise: bigint;
  readonly stops: readonly FrozenFareStop[];
}

/**
 * Redeems quotes for booking registration, inside the caller's transaction. A quote is redeemed
 * once, before it expires, and only for the customer it was quoted to; the row is locked, so two
 * registrations can't both use it.
 */
@Injectable()
export class FareQuoteRedeemer {
  async redeem(
    tx: Tx,
    input: { readonly quoteId: string; readonly customerId: string; readonly at: Date },
  ): Promise<FrozenFare> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM fare_quotes WHERE id = ${input.quoteId}::uuid FOR UPDATE`;
    const frozen = locked.length > 0 ? await this.frozen(tx, input.quoteId) : null;
    // Another customer's quote is reported exactly like a missing one.
    if (!frozen || frozen.customerId !== input.customerId) {
      throw quoteNotFound(HttpStatus.UNPROCESSABLE_ENTITY);
    }
    const quote = await tx.fareQuote.findUniqueOrThrow({
      where: { id: input.quoteId },
      select: { redeemedAt: true, expiresAt: true },
    });
    if (quote.redeemedAt !== null) {
      throw new AppError(
        ErrorCode.QUOTE_ALREADY_USED,
        HttpStatus.CONFLICT,
        'This fare quote was already used for a booking',
      );
    }
    if (quote.expiresAt.getTime() <= input.at.getTime()) {
      throw new AppError(
        ErrorCode.QUOTE_EXPIRED,
        HttpStatus.CONFLICT,
        'This fare quote has expired. Ask for a new quote and confirm the new price',
        { expiredAt: quote.expiresAt.toISOString() },
      );
    }
    await tx.fareQuote.update({ where: { id: input.quoteId }, data: { redeemedAt: input.at } });
    return frozen;
  }

  /** A quote's frozen amounts without redeeming it (for idempotent replays), or null. */
  async frozen(db: Pick<Tx, 'fareQuote'>, quoteId: string): Promise<FrozenFare | null> {
    const quote = await db.fareQuote.findUnique({
      where: { id: quoteId },
      include: {
        stops: { orderBy: { sequence: 'asc' } },
        pricingVersion: { select: { code: true } },
      },
    });
    if (!quote) {
      return null;
    }
    return {
      quoteId: quote.id,
      customerId: quote.customerId,
      pricingVersionId: quote.pricingVersionId,
      pricingVersionCode: quote.pricingVersion.code,
      vehicleCategory: quote.vehicleCategory,
      weightGrams: quote.weightGrams,
      farePaise: quote.farePaise,
      taxPaise: quote.taxPaise,
      payablePaise: quote.payablePaise,
      stops: quote.stops.map((stop) => ({
        quoteStopId: stop.id,
        sequence: stop.sequence,
        farePaise: stop.farePaise,
        taxPaise: stop.taxPaise,
        payablePaise: stop.payablePaise,
      })),
    };
  }
}
