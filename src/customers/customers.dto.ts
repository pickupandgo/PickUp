import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class RegisterCustomerRequest {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 255)
  email?: string;
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
}
