import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** The signed-in driver's account profile. */
export class DriverAccountResponse {
  driverId!: string;
  userId!: string;
  /** The verified phone (E.164) the account was registered with. */
  phone!: string;
  /** PENDING, UNDER_REVIEW, APPROVED, REJECTED, SUSPENDED. */
  approvalStatus!: string;
  legalName!: string | null;
  email!: string | null;
  vehicleType!: string | null;
  vehicleMakeModel!: string | null;
  vehicleRegistrationNumber!: string | null;
  drivingLicenseNumber!: string | null;
  walletBalancePaise!: number;
  createdAt!: string;
}

export class RegisterDriverRequest {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehicleType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vehicleMakeModel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehicleRegistrationNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  drivingLicenseNumber?: string;
}
