import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from './auth.guard';
import { AdminSessionController } from './admin-session.controller';
import { ACCESS_POLICY_KEY } from './decorators';
import { PrincipalService } from './principal.service';
import { TokenVerifier } from './token-verifier.service';
import { APP_CONFIG } from '../config/app-config';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

describe('AdminSessionController', () => {
  let controller: AdminSessionController;
  let guard: AuthGuard;
  const verifier = { verify: jest.fn() };
  const principals = { resolve: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminSessionController],
      providers: [
        AuthGuard,
        Reflector,
        { provide: TokenVerifier, useValue: verifier },
        { provide: PrincipalService, useValue: principals },
        {
          provide: APP_CONFIG,
          useValue: { auth: { provider: 'firebase' }, internalApi: { keys: [] } },
        },
      ],
    }).compile();

    controller = module.get(AdminSessionController);
    guard = module.get(AuthGuard);
    jest.clearAllMocks();
  });

  function context(headers: Record<string, string | undefined> = {}): ExecutionContext {
    const request = { headers };
    return {
      getType: () => 'http',
      getHandler: () => controller.session,
      getClass: () => AdminSessionController,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  }

  it('declares ADMIN access and returns no phone or provider subject', () => {
    const reflector = new Reflector();
    expect(
      reflector.getAllAndOverride(ACCESS_POLICY_KEY, [controller.session, AdminSessionController]),
    ).toBe('ADMIN');

    expect(
      controller.session({
        userId: '7ecefa06-6379-4e2b-9f12-6a97bd3b2652',
        role: 'ADMIN',
        driver: null,
        customer: null,
        session: {
          authenticatedAt: new Date('2026-10-28T10:00:00.000Z'),
          signInProvider: 'phone',
          phoneNumber: '+919999999999',
        },
      }),
    ).toEqual({
      userId: '7ecefa06-6379-4e2b-9f12-6a97bd3b2652',
      role: 'ADMIN',
      authenticatedAt: '2026-10-28T10:00:00.000Z',
      signInProvider: 'phone',
    });
  });

  it('rejects an unauthenticated caller', async () => {
    await expect(guard.canActivate(context())).rejects.toThrow(
      expect.objectContaining({ status: HttpStatus.UNAUTHORIZED }),
    );
  });

  it('rejects a non-admin even if a token payload claims ADMIN, and allows an authoritative ADMIN account', async () => {
    verifier.verify.mockResolvedValue({ subject: 'firebase-subject', role: 'ADMIN' });
    principals.resolve.mockResolvedValueOnce({
      userId: 'customer-id',
      role: 'CUSTOMER',
      driver: null,
      customer: { id: 'customer-id' },
      session: { authenticatedAt: null, signInProvider: 'phone', phoneNumber: null },
    });
    await expect(
      guard.canActivate(context({ authorization: 'Bearer valid.customer.token' })),
    ).rejects.toThrow(expect.objectContaining({ status: HttpStatus.FORBIDDEN }));

    principals.resolve.mockResolvedValueOnce({
      userId: 'admin-id',
      role: 'ADMIN',
      driver: null,
      customer: null,
      session: { authenticatedAt: null, signInProvider: 'phone', phoneNumber: null },
    });
    await expect(
      guard.canActivate(context({ authorization: 'Bearer valid.admin.token' })),
    ).resolves.toBe(true);
  });

  it('denies a suspended administrator before the session handler runs', async () => {
    verifier.verify.mockResolvedValue({ subject: 'suspended-admin-subject' });
    principals.resolve.mockRejectedValueOnce(
      new AppError(ErrorCode.ACCOUNT_DISABLED, HttpStatus.FORBIDDEN, 'This account is disabled'),
    );

    await expect(
      guard.canActivate(context({ authorization: 'Bearer valid.suspended.token' })),
    ).rejects.toMatchObject({
      code: ErrorCode.ACCOUNT_DISABLED,
      status: HttpStatus.FORBIDDEN,
    });
  });
});
