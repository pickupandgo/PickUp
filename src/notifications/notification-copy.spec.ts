import { notificationCopy, type NotificationEvent } from './notification-copy';

describe('privacy-safe MultipleRide notification copy', () => {
  it.each([
    ['DRIVER_ASSIGNED', 'Your driver has accepted your booking.'],
    ['DRIVER_ARRIVED', 'Your driver has reached the pickup location.'],
    ['TRIP_STARTED', 'Your delivery is now in progress.'],
    ['TRIP_COMPLETED', 'Your delivery has been completed.'],
    ['BOOKING_CANCELLED', 'Your booking has been cancelled.'],
  ])('uses event-specific copy for %s', (type, body) => {
    expect(notificationCopy(type as NotificationEvent, 'CUSTOMER')).toMatchObject({
      title: expect.stringMatching(/^MultipleRide • /),
      body,
    });
  });
  it('derives the chat counterpart from the recipient role', () => {
    expect(notificationCopy('NEW_CHAT_MESSAGE', 'DRIVER')?.body).toBe(
      'You have a new message from your customer.',
    );
    expect(notificationCopy('NEW_CHAT_MESSAGE', 'CUSTOMER')?.body).toBe(
      'You have a new message from your driver.',
    );
    expect(notificationCopy('NEW_CHAT_MESSAGE', 'DRIVER', 'hi')?.title).toContain('MultipleRide');
  });
});
