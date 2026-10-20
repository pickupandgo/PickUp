import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentPrincipal, SignedIn } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { ChatMessageDto, SendChatMessageDto } from './chat.dto';
import { ChatService } from './chat.service';

const uuid = new ParseUUIDPipe({ version: '4' });

@ApiTags('chat')
@SignedIn()
@Controller({ version: '1' })
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─── Booking-Scoped Routes ───────────────────────────────────────────────

  @Get('bookings/:bookingId/chat/messages')
  async getBookingMessages(
    @Param('bookingId', uuid) bookingId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ChatMessageDto[]> {
    return this.chatService.getMessages(bookingId, principal);
  }

  @Post('bookings/:bookingId/chat/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendBookingMessage(
    @Param('bookingId', uuid) bookingId: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: SendChatMessageDto,
  ): Promise<ChatMessageDto> {
    return this.chatService.sendMessage(bookingId, principal, dto);
  }

  @Post('bookings/:bookingId/chat/read')
  @HttpCode(HttpStatus.OK)
  async markBookingMessagesAsRead(
    @Param('bookingId', uuid) bookingId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.chatService.markAsRead(bookingId, principal);
  }

  // ─── Trip-Scoped Routes (convenience for driver app) ─────────────────────

  @Get('trips/:tripId/chat/messages')
  async getTripMessages(
    @Param('tripId', uuid) tripId: string,
    @CurrentPrincipal() principal: Principal,
  ): Promise<ChatMessageDto[]> {
    const bookingId = await this.chatService.getBookingIdForTrip(tripId);
    return this.chatService.getMessages(bookingId, principal);
  }

  @Post('trips/:tripId/chat/messages')
  @HttpCode(HttpStatus.CREATED)
  async sendTripMessage(
    @Param('tripId', uuid) tripId: string,
    @CurrentPrincipal() principal: Principal,
    @Body() dto: SendChatMessageDto,
  ): Promise<ChatMessageDto> {
    const bookingId = await this.chatService.getBookingIdForTrip(tripId);
    return this.chatService.sendMessage(bookingId, principal, dto);
  }

  @Post('trips/:tripId/chat/read')
  @HttpCode(HttpStatus.OK)
  async markTripMessagesAsRead(
    @Param('tripId', uuid) tripId: string,
    @CurrentPrincipal() principal: Principal,
  ) {
    const bookingId = await this.chatService.getBookingIdForTrip(tripId);
    return this.chatService.markAsRead(bookingId, principal);
  }
}
