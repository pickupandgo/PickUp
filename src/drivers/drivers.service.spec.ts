import { HttpStatus } from '@nestjs/common';
import { DriversService } from './drivers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Principal, SignedInIdentity } from '../auth/principal';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { createValidationPipe } from '../common/http/validation';
import { RegisterDriverRequest } from './drivers.dto';
import { DriversController } from './drivers.controller';
import type { Response } from 'express';

describe('DriversService', () => {
  let service: DriversService;
  let mockPrisma: {
    $queryRaw: jest.Mock;
    driver: {
      findUniqueOrThrow: jest.Mock;
    };
  };

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
    email: 'rajesh@example.com',
    name: 'Rajesh Kumar',
  };

  const mockDriverDbRow = {
    id: 'd-uuid-1',
    userId: 'u-uuid-1',
    approvalStatus: 'PENDING',
    legalName: 'Rajesh Kumar',
    email: 'rajesh@example.com',
    vehicleType: 'mini_truck',
    vehicleMakeModel: 'Tata Ace Gold',
    vehicleRegistrationNumber: 'RJ14AB1234',
    drivingLicenseNumber: 'RJ1420200012345',
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
    it('successfully registers a new driver with PENDING approval status, vehicle details and zero wallet balance', async () => {
      mockPrisma.$queryRaw.mockResolvedValueOnce([
        {
          outcome: 'CREATED',
          userId: 'u-uuid-1',
          driverId: 'd-uuid-1',
        },
      ]);
      mockPrisma.driver.findUniqueOrThrow.mockResolvedValueOnce(mockDriverDbRow);

      const result = await service.register(validIdentity, {
        legalName: 'Rajesh Kumar',
        vehicleType: 'mini_truck',
        vehicleMakeModel: 'Tata Ace Gold',
        vehicleRegistrationNumber: 'RJ14AB1234',
        drivingLicenseNumber: 'RJ1420200012345',
      });

      expect(result.created).toBe(true);
      expect(result.account.driverId).toBe('d-uuid-1');
      expect(result.account.userId).toBe('u-uuid-1');
      expect(result.account.phone).toBe('+919876543210');
      expect(result.account.approvalStatus).toBe('PENDING');
      expect(result.account.legalName).toBe('Rajesh Kumar');
      expect(result.account.email).toBe('rajesh@example.com');
      expect(result.account.vehicleType).toBe('mini_truck');
      expect(result.account.vehicleMakeModel).toBe('Tata Ace Gold');
      expect(result.account.vehicleRegistrationNumber).toBe('RJ14AB1234');
      expect(result.account.drivingLicenseNumber).toBe('RJ1420200012345');
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
      expect(result.account.vehicleRegistrationNumber).toBe('RJ14AB1234');
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

  describe('RegisterDriverRequest DTO & Validation regression', () => {
    const pipe = createValidationPipe();

    it('successfully validates a payload with driver profile fields only', async () => {
      const validPayload = {
        name: 'Rajesh Kumar',
        vehicleType: 'CAB',
        vehicleMakeModel: 'Swift Dzire',
        vehicleRegistrationNumber: 'RJ14CA1234',
        drivingLicenseNumber: 'RJ1420200012345',
      };

      const transformed = await pipe.transform(validPayload, {
        type: 'body',
        metatype: RegisterDriverRequest,
      });

      expect(transformed).toMatchObject(validPayload);
    });

    it('rejects unknown fields to prevent mass assignment (validating forbidNonWhitelisted)', async () => {
      const payloadWithExtraneousField = {
        name: 'Rajesh Kumar',
        phone: '+919799904730',
        email: 'rajesh@example.com',
        role: 'ADMIN',
        approvalStatus: 'APPROVED',
      };

      await expect(
        pipe.transform(payloadWithExtraneousField, {
          type: 'body',
          metatype: RegisterDriverRequest,
        }),
      ).rejects.toThrow(AppError);
    });

    it('rejects client supplied identity fields', async () => {
      await expect(
        pipe.transform(
          { email: 'attacker@example.com' },
          { type: 'body', metatype: RegisterDriverRequest },
        ),
      ).rejects.toThrow(AppError);
    });
  });

  describe('DriversController', () => {
    let controller: DriversController;

    beforeEach(() => {
      controller = new DriversController(service);
    });

    it('maps only non-identity profile fields and sets HTTP 201 on account creation', async () => {
      const registerSpy = jest.spyOn(service, 'register').mockResolvedValueOnce({
        account: {
          driverId: 'd-uuid-1',
          userId: 'u-uuid-1',
          phone: '+919799904730',
          approvalStatus: 'PENDING',
          legalName: 'Rajesh Kumar',
          email: 'rajesh@example.com',
          vehicleType: 'CAB',
          vehicleMakeModel: 'Swift Dzire',
          vehicleRegistrationNumber: 'RJ14CA1234',
          drivingLicenseNumber: 'RJ1420200012345',
          walletBalancePaise: 0,
          createdAt: new Date().toISOString(),
        },
        created: true,
      });

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
      } as unknown as Response;

      const body: RegisterDriverRequest = {
        name: 'Rajesh Kumar',
        vehicleType: 'CAB',
        vehicleMakeModel: 'Swift Dzire',
        vehicleRegistrationNumber: 'RJ14CA1234',
        drivingLicenseNumber: 'RJ1420200012345',
      };

      const account = await controller.register(validIdentity, body, mockResponse);

      expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.CREATED);
      expect(registerSpy).toHaveBeenCalledWith(validIdentity, {
        legalName: 'Rajesh Kumar',
        vehicleType: 'CAB',
        vehicleMakeModel: 'Swift Dzire',
        vehicleRegistrationNumber: 'RJ14CA1234',
        drivingLicenseNumber: 'RJ1420200012345',
      });
      expect(account.approvalStatus).toBe('PENDING');
      expect(account.vehicleRegistrationNumber).toBe('RJ14CA1234');
    });
  });
});

