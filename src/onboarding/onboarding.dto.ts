import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
export const VEHICLE_CATEGORIES = [
  'TWO_WHEELER',
  'THREE_WHEELER',
  'FOUR_WHEELER',
  'MINI_TRUCK',
  'PICKUP_TRUCK',
] as const;
export class UpdateDriverProfileRequest {
  @IsString() @Length(2, 120) name!: string;
}
export class CreateVehicleRequest {
  @IsIn(VEHICLE_CATEGORIES) category!: (typeof VEHICLE_CATEGORIES)[number];
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9 -]{3,29}$/i) registrationNumber!: string;
  @IsString() @Length(2, 100) makeModel!: string;
}
export class UpdateVehicleRequest extends CreateVehicleRequest {}
export class CreateDocumentRequest {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,39}$/) documentType!: string;
  @IsString() @IsIn(['application/pdf', 'image/jpeg', 'image/png']) contentType!: string;
  @IsInt() @Min(1) @Max(20_000_000) sizeBytes!: number;
}
export class KycReviewRequest {
  @IsIn(['REJECTED', 'NEEDS_CORRECTION']) decision!: 'REJECTED' | 'NEEDS_CORRECTION';
  @IsString() @Length(3, 1000) reason!: string;
}
export class KycVerifyRequest {
  @IsString() @Length(3, 1000) reason!: string;
  @IsObject() checklist!: Record<string, boolean>;
  @IsString() @Length(3, 120) legalName!: string;
}
export class DocumentReviewRequest {
  @IsIn(['VERIFIED', 'REJECTED']) decision!: 'VERIFIED' | 'REJECTED';
  @IsString() @Length(3, 1000) reason!: string;
}
export class VehicleReviewRequest {
  @IsIn(['VERIFIED', 'REJECTED', 'IN_REVIEW']) decision!: 'VERIFIED' | 'REJECTED' | 'IN_REVIEW';
  @IsString() @Length(3, 1000) reason!: string;
}
export class DriverDecisionRequest {
  @IsIn(['APPROVE', 'REJECT', 'CORRECTION', 'SUSPEND']) decision!:
    'APPROVE' | 'REJECT' | 'CORRECTION' | 'SUSPEND';
  @IsString() @Length(3, 1000) reason!: string;
}
export class ReplacementVehicleRequest extends CreateVehicleRequest {
  @IsString() @Length(3, 1000) reason!: string;
}
export class AdminReviewQuery {
  @IsOptional()
  @IsIn(['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'])
  approvalStatus?: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit: number = 50;
}
