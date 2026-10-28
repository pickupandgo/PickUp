import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthGuard } from '../auth/auth.guard';
import { PrincipalService } from '../auth/principal.service';
import { TokenVerifier } from '../auth/token-verifier.service';
import { APP_CONFIG } from '../config/app-config';
import {
  AdminOnboardingController,
  InternalEligibilityController,
} from './admin-onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

describe('AdminOnboardingController & InternalEligibilityController (Guards & Auth)', () => {
  let adminController: AdminOnboardingController;
  let internalController: InternalEligibilityController;
  let onboardingService: any;
  let guard: AuthGuard;

  const validInternalKey = 'internal-test-key-32-chars-minimum-123456';

  beforeEach(async () => {
    onboardingService = {
      reviewKyc: jest.fn(),
      verifyKyc: jest.fn(),
      eligibility: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminOnboardingController, InternalEligibilityController],
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
          useValue: {
            auth: { provider: 'firebase' },
            internalApi: { keys: [validInternalKey] },
          },
        },
      ],
    }).compile();

    adminController = module.get<AdminOnboardingController>(AdminOnboardingController);
    internalController = module.get<InternalEligibilityController>(InternalEligibilityController);
    guard = module.get<AuthGuard>(AuthGuard);
  });

  function createMockContext(
    controllerClass: any,
    handler: Function,
    headers: Record<string, string | undefined> = {},
  ): ExecutionContext {
    const request = {
      headers,
    };
    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => controllerClass,
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  describe('AdminOnboardingController (@AdminOnly)', () => {
    it('rejects unauthenticated review request with 401', async () => {
      const ctx = createMockContext(AdminOnboardingController, adminController.reviewKyc);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.UNAUTHORIZED }),
      );
    });

    it('rejects driver attempting to review KYC with 403 Forbidden', async () => {
      const verifier = (guard as any).verifier;
      const principals = (guard as any).principals;

      verifier.verify.mockResolvedValueOnce({ subject: 'fb-driver' });
      principals.resolve.mockResolvedValueOnce({
        userId: 'u-drv',
        role: 'DRIVER',
        driver: { id: 'd-1', approvalStatus: 'APPROVED' },
        customer: null,
      });

      const ctx = createMockContext(AdminOnboardingController, adminController.reviewKyc, {
        authorization: 'Bearer valid.driver.token',
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.FORBIDDEN }),
      );
    });

    it('rejects customer attempting to review KYC with 403 Forbidden', async () => {
      const verifier = (guard as any).verifier;
      const principals = (guard as any).principals;

      verifier.verify.mockResolvedValueOnce({ subject: 'fb-cust' });
      principals.resolve.mockResolvedValueOnce({
        userId: 'u-cust',
        role: 'CUSTOMER',
        driver: null,
        customer: { id: 'c-1' },
      });

      const ctx = createMockContext(AdminOnboardingController, adminController.reviewKyc, {
        authorization: 'Bearer valid.customer.token',
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        expect.objectContaining({ status: HttpStatus.FORBIDDEN }),
      );
    });

    it('allows an ADMIN principal to access KYC review', async () => {
      const verifier = (guard as any).verifier;
      const principals = (guard as any).principals;

      verifier.verify.mockResolvedValueOnce({ subject: 'fb-admin' });
      principals.resolve.mockResolvedValueOnce({
        userId: 'u-admin',
        role: 'ADMIN',
        driver: null,
        customer: null,
      });

      const ctx = createMockContext(AdminOnboardingController, adminController.reviewKyc, {
        authorization: 'Bearer valid.admin.token',
      });
      expect(await guard.canActivate(ctx)).toBe(true);
    });

    it('allows an ADMIN principal to access KYC verify', async () => {
      const verifier = (guard as any).verifier;
      const principals = (guard as any).principals;

      verifier.verify.mockResolvedValueOnce({ subject: 'fb-admin' });
      principals.resolve.mockResolvedValueOnce({
        userId: 'u-admin',
        role: 'ADMIN',
        driver: null,
        customer: null,
      });

      const ctx = createMockContext(AdminOnboardingController, adminController.verifyKyc, {
        authorization: 'Bearer valid.admin.token',
      });
      expect(await guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('InternalEligibilityController (@InternalOnly)', () => {
    it('rejects request with missing X-Internal-Api-Key with 401', async () => {
      const ctx = createMockContext(InternalEligibilityController, internalController.eligibility);
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.INTERNAL_AUTH_INVALID,
          HttpStatus.UNAUTHORIZED,
          'Internal API key is missing or invalid',
        ),
      );
    });

    it('rejects request with invalid X-Internal-Api-Key with 401', async () => {
      const ctx = createMockContext(InternalEligibilityController, internalController.eligibility, {
        'x-internal-api-key': 'wrong-key',
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        new AppError(
          ErrorCode.INTERNAL_AUTH_INVALID,
          HttpStatus.UNAUTHORIZED,
          'Internal API key is missing or invalid',
        ),
      );
    });

    it('allows server-to-server call with valid X-Internal-Api-Key', async () => {
      const ctx = createMockContext(InternalEligibilityController, internalController.eligibility, {
        'x-internal-api-key': validInternalKey,
      });
      expect(await guard.canActivate(ctx)).toBe(true);
    });
  });
});
