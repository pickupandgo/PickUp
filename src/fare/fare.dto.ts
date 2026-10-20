import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { PRICING_MODELS, VEHICLE_CATEGORY_PATTERN } from './pricing/pricing-config';
import { PRICING_VERSION_CODE_PATTERN } from './pricing-versions';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Technical ceiling on drops in one request, matching the database CHECK. The business limit is
 * configuration (FARE_MAX_DROPS, default 5; open decision D-29) and is checked by the service.
 */
export const TECHNICAL_MAX_DROPS = 25;

export class LocationInput {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(-180)
  @Max(180)
  longitude!: number;
}

/**
 * A route to price. There is no amount here: the server calculates the fare from its pricing
 * version, and an amount sent by the app is rejected like any unknown field.
 */
export class CreateFareQuoteRequest {
  @ValidateNested()
  @Type(() => LocationInput)
  pickup!: LocationInput;

  /** Drops in delivery order: at least 1, at most FARE_MAX_DROPS (TOO_MANY_DROPS otherwise). */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(TECHNICAL_MAX_DROPS)
  @ValidateNested({ each: true })
  @Type(() => LocationInput)
  drops!: LocationInput[];

  /** Vehicle category code, e.g. MINI_TRUCK. Must be priced by the version in effect. */
  @Matches(VEHICLE_CATEGORY_PATTERN, { message: 'vehicleCategory must be an upper-case code' })
  vehicleCategory!: string;

  /** Total goods weight in kg, up to 3 decimals. */
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100_000)
  weightKg!: number;
}

export class FareQuoteDropResponse {
  sequence!: number;
  latitude!: number;
  longitude!: number;
  /** Length of the leg that reaches this drop (from the pickup or the previous drop). */
  distanceMeters!: number;
  farePaise!: number;
  taxPaise!: number;
  /** What this drop's receiver pays when the receivers pay. */
  payablePaise!: number;
}

export class PricingVersionRef {
  pricingVersionId!: string;
  code!: string;
}

export class FareQuoteResponse {
  quoteId!: string;
  pricingVersion!: PricingVersionRef;
  vehicleCategory!: string;
  weightKg!: number;
  pickup!: LocationInput;
  distanceMeters!: number;
  /** Fare excluding taxes, in paise. */
  farePaise!: number;
  taxPaise!: number;
  /** Total to pay: fare + taxes. The sender pays this at once when the sender pays. */
  payablePaise!: number;
  currency!: 'INR';
  drops!: FareQuoteDropResponse[];
  /** Book before this instant, or ask for a new quote. */
  expiresAt!: string;
  /** True once a booking was registered from this quote. */
  redeemed!: boolean;
  createdAt!: string;
}

export class CreatePricingVersionRequest {
  /** Unique code, e.g. PROTOTYPE-2026-10 or V2-2026-11. */
  @Transform(trim)
  @Matches(PRICING_VERSION_CODE_PATTERN, {
    message: 'code must be 2-40 upper-case letters, digits, ".", "_" or "-"',
  })
  code!: string;

  @IsIn(PRICING_MODELS)
  model!: string;

  /** The model's rates and rules; validated against the model. */
  @IsObject()
  config!: Record<string, unknown>;

  /** ISO 8601 start; defaults to now. Versions can't be back-dated. */
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  /** Approval reference and why this version exists. */
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class DeactivatePricingVersionRequest {
  @Transform(trim)
  @IsString()
  @Length(10, 500)
  reason!: string;
}

export class ListPricingVersionsQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  activeOnly?: boolean;
}

export class PricingVersionResponse {
  pricingVersionId!: string;
  code!: string;
  model!: string;
  config!: Record<string, unknown>;
  effectiveFrom!: string;
  effectiveTo!: string | null;
  active!: boolean;
  /** True when this version prices new quotes right now. */
  inEffect!: boolean;
  reason!: string;
  createdByUserId!: string | null;
  deactivatedAt!: string | null;
  deactivationReason!: string | null;
  createdAt!: string;
}

export class CreatePricingVersionResponse {
  version!: PricingVersionResponse;
  /** The previous version, now closed at this version's start. */
  superseded!: PricingVersionResponse | null;
}

export class PricingPreviewResponse {
  pricingVersion!: PricingVersionRef;
  distanceMeters!: number;
  farePaise!: number;
  taxPaise!: number;
  payablePaise!: number;
  drops!: FareQuoteDropResponse[];
}

/** The engine's view of a quote: the route it must run and the amounts it was priced at. */
export class InternalFareQuoteResponse extends FareQuoteResponse {
  customerId!: string;
}
