import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '../auth/auth.guard';
import { PrincipalService } from '../auth/principal.service';
import { TokenVerifier } from '../auth/token-verifier.service';
import { APP_CONFIG } from '../config/app-config';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

describe('OnboardingController (HTTP & Guards)', () => {
  let controller: OnboardingController;
  let onboardingService: any;
  let guard: AuthGuard;

  beforeEach(async () => {
    onboardingService = {
      summary: jest.fn(),
      startKyc: jest.fn(),
      createVehicle: jest.fn(),
      submitVehicle: jest.fn(),
      requestDocument: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OnboardingController],
      providers: [
        { provide: OnboardingService, useValue: onboardingService },
        AuthGuard,
        Reflector,
        {
          provide: TokenVerifier,
          useValue: { verify: jest.fn() },
        },
        {
          provide: PrincipalService,
          useValue: { resolve: jest.fn() },
        },
        {
          provide: APP_CONFIG,
          useValue: { auth: { provider: 'firebase' } },
        },
      ],
    }).compile();

    controller = module.get<OnboardingController>(OnboardingController);
    guard = module.get<AuthGuard>(AuthGuard);
  });

  function createMockContext(handler: Function, authorizationHeader?: string): ExecutionContext {
    const request = {
      headers: {
        authorization: authorizationHeader,
      },
    };
    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => OnboardingController,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  it('rejects unauthenticated requests without Authorization header with 401', async () => {
    const ctx = createMockContext(controller.summary);
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      expect.objectContaining({
        status: HttpStatus.UNAUTHORIZED,
      }),
    );
  });

  it('rejects a customer trying to call driver onboarding with 403 Forbidden', async () => {
    const verifier = (guard as any).verifier;
    const principals = (guard as any).principals;

    verifier.verify.mockResolvedValueOnce({
      subject: 'fb-customer-1',
      phoneNumber: '+919876543210',
    });

    principals.resolve.mockResolvedValueOnce({
      userId: 'u-cust-1',
      role: 'CUSTOMER',
      customer: { id: 'c-1', userId: 'u-cust-1', phone: '+919876543210' },
      driver: null,
    });

    const ctx = createMockContext(controller.summary, 'Bearer valid.jwt.token');
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      expect.objectContaining({
        status: HttpStatus.FORBIDDEN,
      }),
    );
  });

  it('allows a verified driver principal to proceed', async () => {
    const verifier = (guard as any).verifier;
    const principals = (guard as any).principals;

    verifier.verify.mockResolvedValueOnce({
      subject: 'fb-driver-1',
      phoneNumber: '+919876543210',
    });

    principals.resolve.mockResolvedValueOnce({
      userId: 'u-driver-1',
      role: 'DRIVER',
      driver: { id: 'd-1', userId: 'u-driver-1', approvalStatus: 'PENDING' },
      customer: null,
    });

    const ctx = createMockContext(controller.summary, 'Bearer valid.jwt.token');
    const allowed = await guard.canActivate(ctx);
    expect(allowed).toBe(true);
  });
});
