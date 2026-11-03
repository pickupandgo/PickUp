import { notificationUuid, NotificationError } from './NotificationApi';
import type { ActiveTrip } from '../../types/trip';

export interface TripNotificationTarget {
  type: string;
  notificationId?: string;
  bookingId?: string;
  backendTripId?: string;
}
interface Dependencies {
  uid(): string | undefined;
  backendTrip(id: string): Promise<{ tripId: string; bookingId: string; externalRef: string }>;
  engineTrip(rideId: string): Promise<ActiveTrip>;
  eligibility(): Promise<{ eligible: boolean; approvalStatus: string }>;
}
/** Resolve Backend -> Engine identity through the owned booking; never interchange trip IDs. */
export async function authorizeTripNotification(target: TripNotificationTarget, deps: Dependencies) {
  const uid = deps.uid();
  if (!uid || !target.backendTripId || !notificationUuid.test(target.backendTripId))
    throw new NotificationError('This trip reference is unavailable.');
  const check = () => { if (deps.uid() !== uid) throw new NotificationError('Your sign-in changed.'); };
  const backend = await deps.backendTrip(target.backendTripId); check();
  if (backend.tripId !== target.backendTripId || (target.bookingId && backend.bookingId !== target.bookingId))
    throw new NotificationError('Trip references do not match.');
  const rideId = backend.externalRef?.startsWith('ENG-') ? backend.externalRef.slice(4) : '';
  if (!notificationUuid.test(rideId)) throw new NotificationError('Trip reference is unavailable.');
  const trip = await deps.engineTrip(rideId); check();
  if (trip.rideId !== rideId || trip.paymentTripId !== backend.tripId)
    throw new NotificationError('Trip references do not match.');
  const status = String(trip.engineStatus ?? trip.status).toUpperCase();
  if (status === 'CANCELLED') throw new NotificationError('This trip has been cancelled.');
  if (status !== 'COMPLETED') {
    const eligibility = await deps.eligibility(); check();
    if (!eligibility.eligible || eligibility.approvalStatus !== 'APPROVED')
      throw new NotificationError('Driver approval is required.');
  }
  return { screen: status === 'COMPLETED' ? 'TripCompleted' as const : 'ActiveTrip' as const, trip };
}
