const events: Record<string, [string, string]> = {
  NEW_CHAT_MESSAGE: ['New Message', 'You have a new message from your customer.'],
  RIDE_OFFER: ['New Ride Offer', 'A new delivery offer is available. Open the app to review.'],
  DRIVER_ASSIGNED: ['Driver Assigned', 'A driver has accepted the booking.'],
  DRIVER_ARRIVED: ['Driver Arrived', 'The driver has reached the pickup location.'],
  TRIP_STARTED: ['Delivery In Progress', 'Your delivery is now in progress.'],
  ARRIVED_AT_STOP: ['Driver At Delivery Stop', 'The driver has reached a delivery location.'],
  STOP_DELIVERED: ['Drop Completed', 'A delivery stop has been completed.'],
  TRIP_COMPLETED: ['Delivery Completed', 'Your delivery has been completed.'],
  BOOKING_CANCELLED: ['Booking Cancelled', 'Your booking has been cancelled.'],
};
/** Never display arbitrary push bodies or private message contents in a banner. */
export function notificationCopy(type: unknown) {
  const event = typeof type === 'string' ? events[type] : undefined;
  return { title: `MultipleRide • ${event?.[0] ?? 'Update'}`, body: event?.[1] ?? 'Open notifications to view your update.' };
}
