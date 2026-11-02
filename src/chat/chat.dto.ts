import { Transform } from 'class-transformer';
import { IsEmpty, IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from 'class-validator';

export class SendChatMessageDto {
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{16,100}$/)
  clientMessageId?: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  @IsEmpty({ message: 'Chat attachments are not enabled.' })
  imageUrl?: string;
}

export class ChatMessageDto {
  clientMessageId?: string | null;
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
