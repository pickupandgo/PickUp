import {
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
} from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, SignedIn } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import {
  NotificationInboxQuery,
  DeviceTokenResponse,
  NotificationPreferencesResponse,
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

  @Get('inbox')
  async inbox(@CurrentPrincipal() principal: Principal, @Query() query: NotificationInboxQuery) {
    return this.notificationsService.getInbox(principal.userId, principal.role, query.cursor);
  }

  @Post('inbox/:id/read')
  @HttpCode(HttpStatus.OK)
  async readInbox(
    @CurrentPrincipal() principal: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.notificationsService.readInbox(principal.userId, principal.role, id);
  }

  @Post('tokens')
  @HttpCode(HttpStatus.OK)
  async registerToken(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: RegisterDeviceTokenDto,
  ): Promise<DeviceTokenResponse> {
    if (principal.role !== dto.role)
      throw new AppError(
        ErrorCode.FORBIDDEN,
        HttpStatus.FORBIDDEN,
        'Device role must match the signed-in account',
      );
    return this.notificationsService.registerToken(principal.userId, dto);
  }

  @Delete('tokens')
  @HttpCode(HttpStatus.OK)
  async unregisterToken(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UnregisterDeviceTokenDto,
  ): Promise<{ success: boolean }> {
    return this.notificationsService.unregisterToken(dto.token, principal.userId);
  }

  @Get('preferences')
  async getPreferences(
    @CurrentPrincipal() principal: Principal,
  ): Promise<NotificationPreferencesResponse> {
    return this.notificationsService.getPreferences(principal.userId);
  }

  @Put('preferences')
  async updatePreferences(
    @CurrentPrincipal() principal: Principal,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferencesResponse> {
    return this.notificationsService.updatePreferences(principal.userId, dto);
  }
}
