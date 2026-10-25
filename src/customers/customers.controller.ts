import { Body, Controller, Get, HttpStatus, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentIdentity, CurrentPrincipal, CustomerOnly, Public, SignedIn } from '../auth/decorators';
import type { Principal, SignedInIdentity } from '../auth/principal';
import { CustomerAccountResponse, RegisterCustomerRequest } from './customers.dto';
import { CustomersService } from './customers.service';

/** The signed-in customer's own account. */
@ApiTags('customers')
@Controller({ path: 'customers', version: '1' })
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /**
   * Public check: returns whether a customer exists in the database for the given phone number.
   * Used by login screen to verify registration before sending OTP.
   */
  @Public()
  @Get('check-phone')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  checkPhone(@Query('phone') phone: string): Promise<{ exists: boolean }> {
    return this.customers.checkPhone(phone);
  }

  /**
   * Registers the signed-in customer, or returns the existing account (201 when created, 200
   * when it already existed). The sign-in must carry a verified phone number; call this after
   * every sign-in, it is safe to repeat.
   */
  @Post('me')
  @SignedIn()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @CurrentIdentity() identity: SignedInIdentity,
    @Body() body: RegisterCustomerRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CustomerAccountResponse> {
    const { account, created } = await this.customers.register(identity, body);
    response.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return account;
  }

  @Get('me')
  @CustomerOnly()
  get(@CurrentPrincipal() principal: Principal): Promise<CustomerAccountResponse> {
    return this.customers.get(principal);
  }
}
