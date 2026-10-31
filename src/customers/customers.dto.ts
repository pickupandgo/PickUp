import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trimText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** Omitted fields are preserved; only age and address accept explicit null. */
export class UpdateCustomerProfileRequest {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trimText)
  @IsString()
  @Matches(/\S/)
  @MaxLength(120)
  name?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(trimText)
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(120)
  age?: number | null;

  @ValidateIf((_object, value: unknown) => value !== undefined && value !== null)
  @Transform(trimText)
  @IsString()
  @Matches(/\S/)
  @MaxLength(500)
  address?: string | null;
}

/** The signed-in customer's account. */
export class CustomerAccountResponse {
  customerId!: string;
  /** The verified phone (E.164) the account was registered with. One account per phone. */
  phone!: string;
  /** ACTIVE, SUSPENDED or DELETED. Only ACTIVE customers can book and pay. */
  status!: string;
  createdAt!: string;
  name?: string | null;
  email?: string | null;
  age!: number | null;
  address!: string | null;
}
