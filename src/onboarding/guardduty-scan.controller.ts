import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { GuardDutyScanService } from './guardduty-scan.service';

/** EventBridge API Destination target. Authentication is enforced by GuardDutyScanService. */
@Controller({ path: 'onboarding/guardduty', version: '1' })
export class GuardDutyScanController {
  constructor(private readonly guardDuty: GuardDutyScanService) {}

  @Post('events')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  receive(
    @Headers('x-multipleride-guardduty-token') token: string | undefined,
    @Body() body: unknown,
  ) {
    return this.guardDuty.receive(token, body);
  }
}
