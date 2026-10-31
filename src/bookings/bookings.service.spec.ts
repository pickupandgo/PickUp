import { HttpStatus } from '@nestjs/common';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { BookingsService } from './bookings.service';

const BOOKING_ID = '00000000-0000-4000-8000-000000000001';
const DRIVER_ID = '00000000-0000-4000-8000-000000000002';

describe('BookingsService assignment authorization', () => {
  function subjectIdentity() {
    return {
      user: { role: 'DRIVER', driver: { id: DRIVER_ID } },
    };
  }

  function setup(
    options: {
      existing?: { id: string; driverId: string } | null;
      eligible?: boolean;
      category?: string | null;
    } = {},
  ) {
    const booking = { id: BOOKING_ID, status: 'SEARCHING_DRIVER', vehicleCategory: 'MINI_TRUCK' };
    const tx = {
      // lockBooking then lockTripOfBooking; the raw SQL itself is not under test here.
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ id: BOOKING_ID }])
        .mockResolvedValueOnce(options.existing ? [{ id: options.existing.id }] : []),
      booking: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(booking),
        update: jest.fn().mockResolvedValue({ ...booking, status: 'DRIVER_ASSIGNED' }),
      },
      trip: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(options.existing ?? null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'trip-1', bookingId: BOOKING_ID, driverId: DRIVER_ID }),
      },
    };
    const prisma = {
      authIdentity: { findUnique: jest.fn().mockResolvedValue(subjectIdentity()) },
      runInTransaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
    };
    const onboarding = {
      eligibilityIn: jest.fn().mockResolvedValue({
        driverId: DRIVER_ID,
        eligible: options.eligible ?? false,
        reasons: ['KYC_NOT_VERIFIED'],
        vehicleId: null,
        vehicleCategory: options.category === undefined ? 'MINI_TRUCK' : options.category,
        checkedAt: new Date().toISOString(),
      }),
    };
    const service = new BookingsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      onboarding as never,
      { auth: { provider: 'firebase' } } as never,
    );
    return { service, tx, prisma, onboarding };
  }

  it('rejects a new assignment when the current backend compliance contract is ineligible', async () => {
    const { service, tx, onboarding } = setup({ eligible: false });

    await expect(service.assignDriver(BOOKING_ID, 'firebase-driver')).rejects.toMatchObject({
      code: ErrorCode.DRIVER_NOT_ELIGIBLE,
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      details: { reasons: ['KYC_NOT_VERIFIED'] },
    } satisfies Partial<AppError>);

    expect(onboarding.eligibilityIn).toHaveBeenCalledWith(DRIVER_ID, tx);
    expect(tx.trip.create).not.toHaveBeenCalled();
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it('creates a new assignment only after the eligibility check in the booking transaction', async () => {
    const { service, tx, onboarding } = setup({ eligible: true });

    await expect(service.assignDriver(BOOKING_ID, 'firebase-driver')).resolves.toMatchObject({
      booking: { status: 'DRIVER_ASSIGNED' },
      trip: { driverId: DRIVER_ID },
    });

    expect(onboarding.eligibilityIn).toHaveBeenCalledWith(DRIVER_ID, tx);
    expect(tx.trip.create).toHaveBeenCalledWith({
      data: { bookingId: BOOKING_ID, driverId: DRIVER_ID },
    });
  });

  it.each(['TWO_WHEELER', null])(
    'rejects mismatched or missing verified vehicle category %s',
    async (category) => {
      const { service, tx } = setup({ eligible: true, category });
      await expect(service.assignDriver(BOOKING_ID, 'firebase-driver')).rejects.toMatchObject({
        code: ErrorCode.DRIVER_NOT_ELIGIBLE,
        details: { reasons: ['VEHICLE_CATEGORY_MISMATCH'] },
      });
      expect(tx.trip.create).not.toHaveBeenCalled();
    },
  );

  it('preserves an existing trip for the same driver without reauthorizing new work', async () => {
    const existing = { id: 'trip-existing', driverId: DRIVER_ID };
    const { service, tx, onboarding } = setup({ existing, eligible: false });

    await expect(service.assignDriver(BOOKING_ID, 'firebase-driver')).resolves.toMatchObject({
      trip: existing,
    });

    expect(onboarding.eligibilityIn).not.toHaveBeenCalled();
    expect(tx.trip.create).not.toHaveBeenCalled();
  });
});
