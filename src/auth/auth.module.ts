import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import {
  RemoteJwksKeyProvider,
  SigningKeyProvider,
} from './signing-key.provider';
import { TokenVerifier } from './token-verifier.service';

@Module({
  providers: [
    TokenVerifier,
    { provide: SigningKeyProvider, useClass: RemoteJwksKeyProvider },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenVerifier, SigningKeyProvider],
})
export class AuthModule {}
