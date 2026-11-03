import { InternalBookingsController } from './internal-bookings.controller';
import type { BookingsService } from '../bookings/bookings.service';
import type { BookingStopsService } from '../bookings/booking-stops.service';
import type { CollectionsService } from '../collections/collections.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { InternalBookingResponse } from '../bookings/bookings.dto';

describe('internal booking notification production', () => {
  const booking = { id: 'booking-a', customerId: 'customer-a', vehicleCategory: 'TWO_WHEELER' };
  const trip = { id: 'trip-a', driverId: 'driver-a' };
  const bookings = { updateTripStatus: jest.fn(), assignDriver: jest.fn() };
  const stops = { report: jest.fn() };
  const notifications = { sendNotification: jest.fn().mockResolvedValue(1) };
  let controller: InternalBookingsController;
  beforeEach(() => {
    jest.clearAllMocks();
    controller = new InternalBookingsController(
      bookings as unknown as BookingsService,
      stops as unknown as BookingStopsService,
      {} as CollectionsService,
      notifications as unknown as NotificationsService,
    );
    jest
      .spyOn(controller as unknown as { view(): Promise<InternalBookingResponse> }, 'view')
      .mockResolvedValue({} as InternalBookingResponse);
  });
  it('emits trip-start once at actual transit, not again at pickup verification', async () => {
    bookings.updateTripStatus.mockResolvedValue({ booking, trip, changed: true });
    await controller.tripStatus(trip.id, { status: 'PICKUP_VERIFIED' });
    expect(notifications.sendNotification).not.toHaveBeenCalled();
    await controller.tripStatus(trip.id, { status: 'IN_TRANSIT' });
    expect(notifications.sendNotification).toHaveBeenCalledWith(
      booking.customerId,
      'CUSTOMER',
      'TRIP_STARTED',
      {},
      expect.objectContaining({ eventId: 'trip:trip-a:IN_TRANSIT' }),
    );
    bookings.updateTripStatus.mockResolvedValue({ booking, trip, changed: false });
    await controller.tripStatus(trip.id, { status: 'IN_TRANSIT' });
    expect(notifications.sendNotification).toHaveBeenCalledTimes(1);
  });
  it('gives repeat assignment callbacks the same notification event identity', async () => {
    bookings.assignDriver.mockResolvedValue({ booking, trip });
    await controller.assign(booking.id, { driverSubject: 'firebase-driver' });
    await controller.assign(booking.id, { driverSubject: 'firebase-driver' });
    expect(notifications.sendNotification.mock.calls[0][4].eventId).toBe(
      notifications.sendNotification.mock.calls[1][4].eventId,
    );
  });
  it('keeps a legitimate new arrival attempt distinct from an earlier arrival', async () => {
    stops.report
      .mockResolvedValueOnce({
        booking,
        trip,
        changed: true,
        stop: { id: 'stop-a', updatedAt: new Date('2026-11-02T10:00:00Z') },
      })
      .mockResolvedValueOnce({
        booking,
        trip,
        changed: true,
        stop: { id: 'stop-a', updatedAt: new Date('2026-11-02T11:00:00Z') },
      });
    await controller.stopStatus(trip.id, 1, { status: 'ARRIVED' });
    await controller.stopStatus(trip.id, 1, { status: 'ARRIVED' });
    expect(notifications.sendNotification.mock.calls[0][4].eventId).not.toBe(
      notifications.sendNotification.mock.calls[1][4].eventId,
    );
  });
});
