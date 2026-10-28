import { HttpStatus } from '@nestjs/common';
import { PrincipalService } from './principal.service';
import { ErrorCode } from '../common/errors/error-codes';
import type { VerifiedIdentity } from './token-verifier.service';

describe('PrincipalService', () => {
  let service: PrincipalService;
  let mockPrisma: any;
  const mockConfig: any = {
    auth: { provider: 'firebase' },
  };

  beforeEach(() => {
    mockPrisma = {
      authIdentity: {
        findUnique: jest.fn(),
      },
    };
    service = new PrincipalService(mockPrisma, mockConfig);
  });

  const verified: VerifiedIdentity = {
    subject: 'fb-uid-123',
    phoneNumber: '+919876543210',
    signInProvider: 'phone',
    authTime: 1700000000,
    email: null,
    name: null,
  };

  describe('findPrincipal', () => {
    it('returns null when identity does not exist in database', async () => {
      mockPrisma.authIdentity.findUnique.mockResolvedValueOnce(null);

      const result = await service.findPrincipal(verified);
      expect(result).toBeNull();
      expect(mockPrisma.authIdentity.findUnique).toHaveBeenCalledWith({
        where: { provider_subject: { provider: 'firebase', subject: 'fb-uid-123' } },
        select: expect.any(Object),
      });
    });

    it('returns principal when identity exists and user is ACTIVE', async () => {
      mockPrisma.authIdentity.findUnique.mockResolvedValueOnce({
        user: {
          id: 'user-uuid-1',
          role: 'CUSTOMER',
          status: 'ACTIVE',
          driver: null,
          customer: { id: 'cust-uuid-1' },
        },
      });

      const result = await service.findPrincipal(verified);
      expect(result).toEqual({
        userId: 'user-uuid-1',
        role: 'CUSTOMER',
        driver: null,
        customer: { id: 'cust-uuid-1' },
        session: {
          authenticatedAt: new Date(1700000000 * 1000),
          signInProvider: 'phone',
          phoneNumber: '+919876543210',
        },
      });
    });

    it('throws ACCOUNT_DISABLED when user is not ACTIVE', async () => {
      mockPrisma.authIdentity.findUnique.mockResolvedValueOnce({
        user: {
          id: 'user-uuid-suspended',
          role: 'CUSTOMER',
          status: 'SUSPENDED',
          driver: null,
          customer: { id: 'cust-uuid-2' },
        },
      });

      await expect(service.findPrincipal(verified)).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_DISABLED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  describe('resolve', () => {
    it('throws USER_NOT_PROVISIONED (403) when identity is unregistered', async () => {
      mockPrisma.authIdentity.findUnique.mockResolvedValueOnce(null);

      await expect(service.resolve(verified)).rejects.toMatchObject({
        code: ErrorCode.USER_NOT_PROVISIONED,
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('returns resolved principal when identity is found and active', async () => {
      mockPrisma.authIdentity.findUnique.mockResolvedValueOnce({
        user: {
          id: 'user-uuid-driver',
          role: 'DRIVER',
          status: 'ACTIVE',
          driver: { id: 'driver-uuid-1', approvalStatus: 'APPROVED' },
          customer: null,
        },
      });

      const result = await service.resolve(verified);
      expect(result.userId).toBe('user-uuid-driver');
      expect(result.role).toBe('DRIVER');
      expect(result.driver?.approvalStatus).toBe('APPROVED');
    });
  });
});
