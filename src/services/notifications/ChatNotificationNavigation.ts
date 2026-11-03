import { notificationUuid, NotificationError } from './NotificationApi';
import type { ChatRouteParams } from '../../types/navigation';

interface Dependencies {
  uid(): string | undefined;
  eligibility(): Promise<{ eligible: boolean; approvalStatus: string }>;
  activeTrip(): Promise<{
    id: string;
    paymentTripId?: string | null;
    status?: string;
    engineStatus?: string;
  } | null>;
  summary(backendTripId: string): Promise<{ bookingId: string | null }>;
}
/** Push/inbox data is only a hint. Re-read eligibility, Engine assignment and Backend ownership. */
export async function authorizeChatNotification(
  bookingId: string,
  deps: Dependencies,
): Promise<ChatRouteParams> {
  if (!notificationUuid.test(bookingId))
    throw new NotificationError('Invalid conversation reference.');
  const uid = deps.uid();
  if (!uid) throw new NotificationError('Sign in to open trip messages.');
  const check = () => {
    if (deps.uid() !== uid)
      throw new NotificationError('Your sign-in changed. Please try again.');
  };
  const eligibility = await deps.eligibility();
  check();
  if (
    eligibility.eligible !== true ||
    eligibility.approvalStatus !== 'APPROVED'
  )
    throw new NotificationError(
      'Complete the required driver approval checks before opening messages.',
    );
  const trip = await deps.activeTrip();
  check();
  if (
    !trip?.paymentTripId ||
    !notificationUuid.test(trip.paymentTripId) ||
    [trip.status, trip.engineStatus].some(status =>
      ['COMPLETED', 'CANCELLED'].includes(String(status).toUpperCase()),
    )
  )
    throw new NotificationError(
      'No active assigned trip is available for this message.',
    );
  const summary = await deps.summary(trip.paymentTripId);
  check();
  if (summary.bookingId !== bookingId)
    throw new NotificationError(
      'This message does not belong to your active trip.',
    );
  return { tripId: trip.id, paymentTripId: trip.paymentTripId, bookingId };
}
