import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { AdminOnly, CurrentPrincipal } from './decorators';
import type { Principal } from './principal';

/**
 * Minimal, authoritative session contract for browser-based admin clients.
 *
 * Authentication is still performed by Firebase and the global AuthGuard. This endpoint merely
 * proves that the verified token maps to an active ADMIN account in MultipleRide; it does not
 * create a session, expose a phone number, or accept a caller-supplied role.
 */
export class AdminSessionResponse {
  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ enum: ['ADMIN'] })
  role!: 'ADMIN';

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  authenticatedAt!: string | null;

  @ApiProperty({ nullable: true, example: 'phone' })
  signInProvider!: string | null;
}

@ApiTags('admin')
@Controller({ path: 'admin/session', version: '1' })
export class AdminSessionController {
  @Get()
  @AdminOnly()
  @ApiOperation({
    summary: 'Return the current authoritative admin session',
    description:
      'Requires a Firebase ID token that resolves to an active MultipleRide ADMIN user. This endpoint never creates or promotes an administrator.',
  })
  @ApiOkResponse({ type: AdminSessionResponse })
  session(@CurrentPrincipal() principal: Principal): AdminSessionResponse {
    return {
      userId: principal.userId,
      role: 'ADMIN',
      authenticatedAt: principal.session.authenticatedAt?.toISOString() ?? null,
      signInProvider: principal.session.signInProvider,
    };
  }
}
