import { IsIn, IsInt, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class ProofBinding {
  @IsUUID('4') paymentTripId!: string;
  @IsUUID('4') engineTripId!: string;
  @IsUUID('4') engineStopId!: string;
  @IsInt() @Min(1) @Max(100) sequence!: number;
  @IsString() @Length(1, 128) subject!: string;
}
export class InitiateProof extends ProofBinding {
  @IsIn(['image/jpeg', 'image/png']) contentType!: string;
  @IsInt() @Min(1) @Max(5 * 1024 * 1024) sizeBytes!: number;
}
