import { ApiProperty } from '@nestjs/swagger';

export class DriverProfileResponse {
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({
    description: 'Verified persisted authentication phone; never accepted from the client',
  })
  phone!: string;
  @ApiProperty({ type: String, nullable: true, example: '1995-05-03' }) dateOfBirth!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) residentialAddress!: string | null;
  @ApiProperty({ type: String, nullable: true }) city!: string | null;
  @ApiProperty({ type: String, nullable: true }) state!: string | null;
  @ApiProperty({ type: String, nullable: true }) pinCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) gender!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ type: [String] }) missingFields!: string[];
  @ApiProperty({ type: Number, nullable: true }) minimumAge!: number | null;
  @ApiProperty({ type: String, nullable: true }) licenceExpiresOn!: string | null;
  @ApiProperty({ type: [String] }) licenceVehicleClasses!: string[];
  @ApiProperty() detailsComplete!: boolean;
  @ApiProperty({ type: Number, nullable: true, description: 'Calculated in UTC at request time' })
  age!: number | null;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Unknown until an approved minimum-age policy is configured',
  })
  ageEligible!: boolean | null;
  @ApiProperty({ type: String, nullable: true }) licenceLast4!: string | null;
}
export class DriverOnboardingResponse {
  @ApiProperty() driverId!: string;
  @ApiProperty() approvalStatus!: string;
  @ApiProperty() profileComplete!: boolean;
  @ApiProperty({ type: String, nullable: true }) profileName!: string | null;
  @ApiProperty({ type: DriverProfileResponse }) profile!: DriverProfileResponse;
  @ApiProperty() eligible!: boolean;
  @ApiProperty({ type: [String] }) eligibilityReasons!: string[];
  @ApiProperty({ type: [String] }) availableVehicleCategories!: string[];
  @ApiProperty({ type: String, nullable: true }) selectedVehicleCategory!: string | null;
  @ApiProperty() next!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'kyc, vehicle (legacy), vehicleByCategory: approved document-code lists',
  })
  requiredDocuments!: object;
  @ApiProperty({ type: 'object', additionalProperties: true }) capabilities!: object;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) kyc!: object | null;
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true } })
  vehicles!: object[];
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) activeVehicle!:
    object | null;
  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true }) latestDecision!:
    object | null;
}
