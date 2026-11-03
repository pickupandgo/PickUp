const listeners = new Set<() => void>();
export const tripHistoryEvents = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  invalidate() { listeners.forEach(listener => listener()); },
};
export const historyPushTypes = new Set(['RIDE_OFFER', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVED', 'TRIP_STARTED',
  'ARRIVED_AT_STOP', 'STOP_DELIVERED', 'TRIP_COMPLETED', 'BOOKING_CANCELLED']);
