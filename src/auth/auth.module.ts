import { Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { PrincipalService } from './principal.service';
import { RemoteJwksKeyProvider, SigningKeyProvider } from './signing-key.provider';
import { TokenVerifier } from './token-verifier.service';

@Module({
  providers: [
    { provide: SigningKeyProvider, useClass: RemoteJwksKeyProvider },
    TokenVerifier,
    PrincipalService,
    AuthGuard,
  ],
  exports: [SigningKeyProvider, TokenVerifier, PrincipalService, AuthGuard],
})
export class AuthModule {}
