import {
  IsIn,
  IsArray,
  ArrayMaxSize,
  IsEmail,
  ValidateIf,
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
  @IsOptional() @IsIn([2]) profileVersion?: 2;
  @ValidateIf(
    (o: UpdateDriverProfileRequest) => o.profileVersion === 2 || o.dateOfBirth !== undefined,
  )
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;
  @IsOptional() @IsIn(['FEMALE', 'MALE', 'OTHER', 'PREFER_NOT_TO_SAY']) gender?: string;
  @ValidateIf((o: UpdateDriverProfileRequest) => o.profileVersion === 2 || o.email !== undefined)
  @IsEmail()
  @Length(3, 255)
  email?: string;
  @ValidateIf(
    (o: UpdateDriverProfileRequest) => o.profileVersion === 2 || o.residentialAddress !== undefined,
  )
  @IsString()
  @Length(5, 500)
  residentialAddress?: string;
  @ValidateIf((o: UpdateDriverProfileRequest) => o.profileVersion === 2 || o.city !== undefined)
  @IsString()
  @Length(2, 100)
  city?: string;
  @ValidateIf((o: UpdateDriverProfileRequest) => o.profileVersion === 2 || o.state !== undefined)
  @IsString()
  @Length(2, 100)
  state?: string;
  @ValidateIf((o: UpdateDriverProfileRequest) => o.profileVersion === 2 || o.pinCode !== undefined)
  @IsString()
  @Matches(/^[1-9][0-9]{5}$/)
  pinCode?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9 -]{5,50}$/i) drivingLicenseNumber?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) licenceExpiresOn?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^[A-Z0-9_-]{1,20}$/, { each: true })
  licenceVehicleClasses?: string[];
}
export class SaveVehicleCategoryRequest {
  @IsIn(VEHICLE_CATEGORIES) category!: (typeof VEHICLE_CATEGORIES)[number];
}
export class SensitiveAccessRequest {
  @IsString() @Length(3, 1000) reason!: string;
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
