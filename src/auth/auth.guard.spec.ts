import { ExecutionContext, HttpStatus, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { ErrorCode } from '../common/errors/error-codes';

describe('AuthGuard', () => {
  let guard: AuthGuard;
  let mockReflector: Partial<Reflector>;
  let mockVerifier: any;
  let mockPrincipals: any;
  const mockConfig: any = {
    auth: { provider: 'firebase' },
    internalApi: { keys: ['test-internal-key'] },
  };

  beforeEach(() => {
    mockReflector = {
      getAllAndOverride: jest.fn(),
    };
    mockVerifier = {
      verify: jest.fn(),
    };
    mockPrincipals = {
      findPrincipal: jest.fn(),
      resolve: jest.fn(),
    };
    guard = new AuthGuard(
      mockReflector as Reflector,
      mockVerifier,
      mockPrincipals,
      mockConfig,
    );
  });

  const createMockContext = (headers: Record<string, string> = {}): { context: ExecutionContext; request: any } => {
    const request: any = { headers };
    const context: any = {
      getType: () => 'http',
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    };
    return { context, request };
  };

  it('allows access for PUBLIC policy without token check', async () => {
    (mockReflector.getAllAndOverride as jest.Mock).mockReturnValue('PUBLIC');
    const { context } = createMockContext();

    const allowed = await guard.canActivate(context);
    expect(allowed).toBe(true);
    expect(mockVerifier.verify).not.toHaveBeenCalled();
  });

  it('throws AUTH_REQUIRED (401) when Authorization header is missing', async () => {
    (mockReflector.getAllAndOverride as jest.Mock).mockReturnValue('CUSTOMER');
    const { context } = createMockContext();

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.AUTH_REQUIRED,
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('throws AUTH_INVALID_TOKEN (401) when header is not a Bearer token', async () => {
    (mockReflector.getAllAndOverride as jest.Mock).mockReturnValue('CUSTOMER');
    const { context } = createMockContext({ authorization: 'Basic 12345' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.AUTH_INVALID_TOKEN,
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  describe('SIGNED_IN policy', () => {
    beforeEach(() => {
      (mockReflector.getAllAndOverride as jest.Mock).mockReturnValue('SIGNED_IN');
    });

    it('sets identity and leaves principal undefined when user is unregistered', async () => {
      const { context, request } = createMockContext({ authorization: 'Bearer eyJhbGci.eyJzdWIi.signature' });
      mockVerifier.verify.mockResolvedValueOnce({
        subject: 'unregistered-uid',
        phoneNumber: '+919999999999',
        signInProvider: 'phone',
      });
      mockPrincipals.findPrincipal.mockResolvedValueOnce(null);

      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
      expect(request.identity).toEqual({
        provider: 'firebase',
        subject: 'unregistered-uid',
        phoneNumber: '+919999999999',
        signInProvider: 'phone',
      });
      expect(request.principal).toBeUndefined();
    });

    it('attaches principal when identity is already registered', async () => {
      const { context, request } = createMockContext({ authorization: 'Bearer eyJhbGci.eyJzdWIi.signature' });
      mockVerifier.verify.mockResolvedValueOnce({
        subject: 'registered-uid',
        phoneNumber: '+919876543210',
        signInProvider: 'phone',
      });
      const principal = {
        userId: 'user-uuid-1',
        role: 'CUSTOMER',
        customer: { id: 'cust-uuid-1' },
      };
      mockPrincipals.findPrincipal.mockResolvedValueOnce(principal);

      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
      expect(request.identity).toBeDefined();
      expect(request.principal).toEqual(principal);
    });
  });

  describe('CUSTOMER policy', () => {
    beforeEach(() => {
      (mockReflector.getAllAndOverride as jest.Mock).mockReturnValue('CUSTOMER');
    });

    it('allows registered customer', async () => {
      const { context, request } = createMockContext({ authorization: 'Bearer eyJhbGci.eyJzdWIi.signature' });
      mockVerifier.verify.mockResolvedValueOnce({
        subject: 'cust-uid',
        phoneNumber: '+919876543210',
      });
      const principal = {
        userId: 'user-uuid-1',
        role: 'CUSTOMER',
        customer: { id: 'cust-uuid-1' },
      };
      mockPrincipals.resolve.mockResolvedValueOnce(principal);

      const allowed = await guard.canActivate(context);
      expect(allowed).toBe(true);
      expect(request.principal).toEqual(principal);
    });

    it('rejects user with DRIVER role with 403 Forbidden', async () => {
      const { context } = createMockContext({ authorization: 'Bearer eyJhbGci.eyJzdWIi.signature' });
      mockVerifier.verify.mockResolvedValueOnce({
        subject: 'driver-uid',
        phoneNumber: '+919799904730',
      });
      const principal = {
        userId: 'user-uuid-driver',
        role: 'DRIVER',
        driver: { id: 'driver-uuid-1', approvalStatus: 'APPROVED' },
        customer: null,
      };
      mockPrincipals.resolve.mockResolvedValueOnce(principal);

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        code: ErrorCode.FORBIDDEN,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });
});
