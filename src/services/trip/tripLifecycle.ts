import type { ActiveTrip } from '../../types/trip';

// DELIVERED still needs the engine's explicit completion/payment confirmation.
export const isTerminalTrip = (trip: ActiveTrip): boolean => trip.engineStatus
  ? ['COMPLETED', 'CANCELLED'].includes(trip.engineStatus)
  : ['completed', 'cancelled', 'expired'].includes(trip.status);
