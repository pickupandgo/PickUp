import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendChatMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  imageUrl?: string;
}

export class ChatMessageDto {
  id!: string;
  bookingId!: string;
  senderUserId!: string;
  senderRole!: 'CUSTOMER' | 'DRIVER' | 'SYSTEM';
  text!: string;
  imageUrl?: string | null;
  status!: 'sending' | 'sent' | 'delivered' | 'read' | 'error';
  timestamp!: string;
  readAt?: string | null;
}
