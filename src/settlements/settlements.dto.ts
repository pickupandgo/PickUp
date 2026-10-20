import { IsOptional, IsUUID, Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class SettlementSyncRequest {
  /** First settlement date to pull (YYYY-MM-DD, India date). Defaults to `to`. */
  @IsOptional()
  @Matches(DAY, { message: 'from must be YYYY-MM-DD' })
  from?: string;

  /** Last settlement date to pull (YYYY-MM-DD, India date). Defaults to today. */
  @IsOptional()
  @Matches(DAY, { message: 'to must be YYYY-MM-DD' })
  to?: string;
}

export class ListSettlementsQuery {
  @IsOptional()
  @IsUUID('4')
  bookingId?: string;
}

export class SettlementSyncResponse {
  enabled!: boolean;
  trigger!: string;
  days!: string[];
  seen!: number;
  recorded!: number;
  alreadyRecorded!: number;
  notBookingPayments!: number;
  unknownPayments!: number;
  /** Settlements whose amount differs from our payment. Never recorded; investigate each one. */
  amountMismatches!: number;
  earningsPromoted!: number;
  earningsLinkedOnHold!: number;
}

export class SettlementResponse {
  settlementId!: string;
  provider!: string;
  providerPaymentId!: string;
  providerSettlementId!: string;
  settlementUtr!: string | null;
  settledAt!: string;
  amountPaise!: number;
  feePaise!: number;
  taxPaise!: number;
  bookingId!: string;
  paymentId!: string | null;
  collectionId!: string | null;
  source!: string;
  recordedAt!: string;
}
