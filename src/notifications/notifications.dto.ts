import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsIn(['CUSTOMER', 'DRIVER'])
  role!: 'CUSTOMER' | 'DRIVER';

  @IsIn(['ANDROID', 'IOS', 'WEB'])
  @IsOptional()
  platform?: 'ANDROID' | 'IOS' | 'WEB';

  @IsIn(['en', 'hi'])
  @IsOptional()
  language?: 'en' | 'hi';
}

export class UnregisterDeviceTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class UpdateNotificationPreferencesDto {
  @IsBoolean()
  @IsOptional()
  pushEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  soundEnabled?: boolean;

  @IsIn(['en', 'hi'])
  @IsOptional()
  language?: 'en' | 'hi';
}
