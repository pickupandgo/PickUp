import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, SignedIn } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import {
  RegisterDeviceTokenDto,
  UnregisterDeviceTokenDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@SignedIn()
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('tokens')
  @HttpCode(HttpStatus.OK)
  async registerToken(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.notificationsService.registerToken(principal.userId, dto);
  }

  @Delete('tokens')
  @HttpCode(HttpStatus.OK)
  async unregisterToken(@Body() dto: UnregisterDeviceTokenDto) {
    return this.notificationsService.unregisterToken(dto.token);
  }

  @Get('preferences')
  async getPreferences(@CurrentPrincipal() principal: Principal) {
    return this.notificationsService.getPreferences(principal.userId);
  }

  @Put('preferences')
  async updatePreferences(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(principal.userId, dto);
  }
}
