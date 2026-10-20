import { HttpStatus } from '@nestjs/common';
import { DriversService } from './drivers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Principal, SignedInIdentity } from '../auth/principal';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

describe('DriversService', () => {
  let service: DriversService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      driver: {
        findUniqueOrThrow: jest.fn(),
      },
    };

    service = new DriversService(mockPrisma as unknown as PrismaService);
  });

  const validIdentity: SignedInIdentity = {
    provider: 'firebase',
    subject: 'fb-driver-123',
    signInProvider: 'phone',
    phoneNumber: '+919876543210',
  };

  const mockDriverDbRow = {
    id: 'd-uuid-1',
    userId: 'u-uuid-1',
    approvalStatus: 'PENDING',
    legalName: 'Rajesh Kumar',
    createdAt: new Date('2026-10-20T10:00:00Z'),
    user: {
      id: 'u-uuid-1',
      phone: '+919876543210',
      status: 'ACTIVE',
    },
    wallet: {
      balancePaise: 0n,
    },
  };

  describe('register', () => {
    it('successfully registers a new driver with PENDING approval status and zero wallet balance', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'CREATED',
          userId: 'u-uuid-1',
          driverId: 'd-uuid-1',
        },
      ]);
      mockPrisma.driver.findUniqueOrThrow.mockResolvedValueOnce(mockDriverDbRow);

      const result = await service.register(validIdentity, 'Rajesh Kumar');

      expect(result.created).toBe(true);
      expect(result.account.driverId).toBe('d-uuid-1');
      expect(result.account.userId).toBe('u-uuid-1');
      expect(result.account.phone).toBe('+919876543210');
      expect(result.account.approvalStatus).toBe('PENDING');
      expect(result.account.legalName).toBe('Rajesh Kumar');
      expect(result.account.walletBalancePaise).toBe(0);
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    });

    it('returns existing driver account when already registered', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'EXISTING',
          userId: 'u-uuid-1',
          driverId: 'd-uuid-1',
        },
      ]);
      mockPrisma.driver.findUniqueOrThrow.mockResolvedValueOnce(mockDriverDbRow);

      const result = await service.register(validIdentity, 'Rajesh Kumar');

      expect(result.created).toBe(false);
      expect(result.account.driverId).toBe('d-uuid-1');
      expect(result.account.approvalStatus).toBe('PENDING');
    });

    it('rejects registration when phone number is missing or invalid', async () => {
      const invalidIdentity: SignedInIdentity = {
        ...validIdentity,
        phoneNumber: 'not-a-phone',
      };

      await expect(service.register(invalidIdentity, 'Rajesh Kumar')).rejects.toThrow(AppError);
      await expect(service.register(invalidIdentity, 'Rajesh Kumar')).rejects.toMatchObject({
        code: ErrorCode.PHONE_VERIFICATION_REQUIRED,
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('rejects registration when phone is already registered to another user', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'PHONE_TAKEN',
          userId: null,
          driverId: null,
        },
      ]);

      await expect(service.register(validIdentity, 'Rajesh Kumar')).rejects.toMatchObject({
        code: ErrorCode.PHONE_ALREADY_REGISTERED,
        status: HttpStatus.CONFLICT,
      });
    });

    it('rejects registration when account has role conflict', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'ROLE_CONFLICT',
          userId: 'u-1',
          driverId: null,
        },
      ]);

      await expect(service.register(validIdentity, 'Rajesh Kumar')).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_ROLE_CONFLICT,
        status: HttpStatus.CONFLICT,
      });
    });

    it('rejects registration when account is disabled', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'DISABLED',
          userId: 'u-1',
          driverId: 'd-1',
        },
      ]);

      await expect(service.register(validIdentity, 'Rajesh Kumar')).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_DISABLED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  describe('get', () => {
    it('returns driver profile for authorized driver principal', async () => {
      const principal: Principal = {
        userId: 'u-uuid-1',
        role: 'DRIVER',
        driver: { id: 'd-uuid-1', approvalStatus: 'PENDING' },
        customer: null,
        session: {
          authenticatedAt: new Date(),
          signInProvider: 'phone',
          phoneNumber: '+919876543210',
        },
      };

      mockPrisma.driver.findUniqueOrThrow.mockResolvedValueOnce(mockDriverDbRow);

      const account = await service.get(principal);
      expect(account.driverId).toBe('d-uuid-1');
      expect(account.phone).toBe('+919876543210');
      expect(account.approvalStatus).toBe('PENDING');
    });

    it('throws forbidden if principal is not a driver', async () => {
      const nonDriverPrincipal: Principal = {
        userId: 'u-uuid-2',
        role: 'CUSTOMER',
        driver: null,
        customer: { id: 'c-uuid-1' },
        session: {
          authenticatedAt: new Date(),
          signInProvider: 'phone',
          phoneNumber: '+919876543210',
        },
      };

      await expect(service.get(nonDriverPrincipal)).rejects.toThrow();
    });
  });
});
