import { HttpStatus } from '@nestjs/common';
import type { SignedInIdentity, Principal } from '../auth/principal';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { CustomersService } from './customers.service';

describe('CustomersService', () => {
  let service: CustomersService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      $queryRaw: jest.fn(),
      customer: {
        findUniqueOrThrow: jest.fn(),
      },
    };
    service = new CustomersService(mockPrisma);
  });

  const validIdentity: SignedInIdentity = {
    provider: 'firebase',
    subject: 'fb-user-12345',
    phoneNumber: '+919876543210',
    signInProvider: 'phone',
  };

  describe('register', () => {
    it('throws PHONE_VERIFICATION_REQUIRED when phone is missing or null', async () => {
      const identityWithoutPhone: SignedInIdentity = {
        ...validIdentity,
        phoneNumber: null,
      };

      await expect(service.register(identityWithoutPhone)).rejects.toMatchObject({
        code: ErrorCode.PHONE_VERIFICATION_REQUIRED,
        status: HttpStatus.FORBIDDEN,
      });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('throws PHONE_VERIFICATION_REQUIRED when phone is not valid E.164', async () => {
      const identityWithInvalidPhone: SignedInIdentity = {
        ...validIdentity,
        phoneNumber: '9876543210', // Missing +
      };

      await expect(service.register(identityWithInvalidPhone)).rejects.toMatchObject({
        code: ErrorCode.PHONE_VERIFICATION_REQUIRED,
        status: HttpStatus.FORBIDDEN,
      });
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('registers a new customer atomically when outcome is CREATED', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'CREATED',
          userId: 'user-uuid-1',
          customerId: 'cust-uuid-1',
        },
      ]);

      mockPrisma.customer.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'cust-uuid-1',
        name: 'Aarav Patel',
        email: 'aarav.patel@example.com',
        createdAt: new Date('2026-10-21T10:00:00Z'),
        user: {
          phone: '+919876543210',
          status: 'ACTIVE',
        },
      });

      const result = await service.register(validIdentity, {
        name: 'Aarav Patel',
        email: 'aarav.patel@example.com',
      });

      expect(mockPrisma.$queryRaw).toHaveBeenCalled();
      expect(result.created).toBe(true);
      expect(result.account).toEqual({
        customerId: 'cust-uuid-1',
        phone: '+919876543210',
        status: 'ACTIVE',
        name: 'Aarav Patel',
        email: 'aarav.patel@example.com',
        createdAt: '2026-10-21T10:00:00.000Z',
      });
    });

    it('returns existing account idempotently when outcome is EXISTING', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'EXISTING',
          userId: 'user-uuid-1',
          customerId: 'cust-uuid-1',
        },
      ]);

      mockPrisma.customer.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'cust-uuid-1',
        name: 'Aarav Patel',
        email: 'aarav.patel@example.com',
        createdAt: new Date('2026-10-21T10:00:00Z'),
        user: {
          phone: '+919876543210',
          status: 'ACTIVE',
        },
      });

      const result = await service.register(validIdentity);

      expect(result.created).toBe(false);
      expect(result.account.customerId).toBe('cust-uuid-1');
    });

    it('throws PHONE_ALREADY_REGISTERED on PHONE_TAKEN outcome', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'PHONE_TAKEN',
          userId: null,
          customerId: null,
        },
      ]);

      await expect(service.register(validIdentity)).rejects.toMatchObject({
        code: ErrorCode.PHONE_ALREADY_REGISTERED,
        status: HttpStatus.CONFLICT,
      });
    });

    it('throws ACCOUNT_ROLE_CONFLICT on ROLE_CONFLICT outcome', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'ROLE_CONFLICT',
          userId: 'user-uuid-driver',
          customerId: null,
        },
      ]);

      await expect(service.register(validIdentity)).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_ROLE_CONFLICT,
        status: HttpStatus.CONFLICT,
      });
    });

    it('throws ACCOUNT_DISABLED on DISABLED outcome', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'DISABLED',
          userId: 'user-uuid-disabled',
          customerId: 'cust-uuid-disabled',
        },
      ]);

      await expect(service.register(validIdentity)).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_DISABLED,
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  describe('get', () => {
    it('loads customer account for a valid customer principal', async () => {
      const mockPrincipal: Principal = {
        userId: 'user-uuid-1',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        phone: '+919876543210',
        customer: { id: 'cust-uuid-1' },
      } as any;

      mockPrisma.customer.findUniqueOrThrow.mockResolvedValueOnce({
        id: 'cust-uuid-1',
        name: 'Aarav Patel',
        email: 'aarav.patel@example.com',
        createdAt: new Date('2026-10-21T10:00:00Z'),
        user: {
          phone: '+919876543210',
          status: 'ACTIVE',
        },
      });

      const account = await service.get(mockPrincipal);

      expect(account.customerId).toBe('cust-uuid-1');
      expect(account.name).toBe('Aarav Patel');
      expect(account.email).toBe('aarav.patel@example.com');
    });
  });

  describe('checkPhone', () => {
    it('returns { exists: false } when phone is empty or invalid', async () => {
      mockPrisma.customer = { findFirst: jest.fn() };
      expect(await service.checkPhone('')).toEqual({ exists: false });
      expect(await service.checkPhone(null as any)).toEqual({ exists: false });
      expect(mockPrisma.customer.findFirst).not.toHaveBeenCalled();
    });

    it('returns { exists: true } when customer exists', async () => {
      mockPrisma.customer = {
        findFirst: jest.fn().mockResolvedValueOnce({ id: 'cust-1' }),
      };

      const result = await service.checkPhone('9876543210');
      expect(result).toEqual({ exists: true });
      expect(mockPrisma.customer.findFirst).toHaveBeenCalledWith({
        where: {
          user: {
            phone: '+9876543210',
            status: 'ACTIVE',
          },
        },
        select: { id: true },
      });
    });

    it('returns { exists: false } when customer does not exist', async () => {
      mockPrisma.customer = {
        findFirst: jest.fn().mockResolvedValueOnce(null),
      };

      const result = await service.checkPhone('+919876543210');
      expect(result).toEqual({ exists: false });
    });
  });
});
