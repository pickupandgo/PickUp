import { Module } from '@nestjs/common';
import { AdminSessionController } from './admin-session.controller';
import { AuthGuard } from './auth.guard';
import { PrincipalService } from './principal.service';
import { RemoteJwksKeyProvider, SigningKeyProvider } from './signing-key.provider';
import { TokenVerifier } from './token-verifier.service';

@Module({
  controllers: [AdminSessionController],
  providers: [
    { provide: SigningKeyProvider, useClass: RemoteJwksKeyProvider },
    TokenVerifier,
    PrincipalService,
    AuthGuard,
  ],
  exports: [SigningKeyProvider, TokenVerifier, PrincipalService, AuthGuard],
})
export class AuthModule {}
