import { cancelRide, getRide, recoverRide } from '../api/engine';
import { ApiError } from '../api/http';
import type { CreateRideInput, Ride } from '../api/types';
import { bookingOwner, bookingRevision, readPendingBooking, writePendingBooking } from '../state/pendingBooking';

/** Leaving for Home or vehicle selection ends only a server-confirmed exhausted search, never an assigned trip. */
export const leaveFailedSearch = async (customerId: string | undefined, ride?: Ride, pendingInput?: CreateRideInput, signal?: AbortSignal): Promise<{ kind: 'released' } | { kind: 'active'; ride: Ride }> => {
  const uid = bookingOwner();
  if (customerId !== uid) throw new ApiError('session_changed', 'Your sign-in changed. Please retry.');
  const revision = bookingRevision(uid);
  const saved = await readPendingBooking(uid);
  const quoteId = saved?.input.quoteId ?? pendingInput?.quoteId ?? ride?.quoteId;
  if ((saved?.rideId && ride?.id && saved.rideId !== ride.id) || (saved && pendingInput && saved.input.quoteId !== pendingInput.quoteId)) throw new ApiError('http', 'Your booking changed. Please resume it from Home.');
  const checkOwner = () => {
    if (signal?.aborted || bookingOwner() !== uid || bookingRevision(uid) !== revision) throw new ApiError('session_changed', 'Your sign-in changed. Please retry.');
  };
  checkOwner();
  const id = saved?.rideId ?? ride?.id;
  let latest = id ? await getRide(id, signal) : await recoverRide(quoteId, signal);
  checkOwner();
  if (!latest && (saved || pendingInput || ride)) throw new ApiError('http', 'Could not confirm your previous booking. Please retry.');
  if (latest && quoteId && latest.quoteId && latest.quoteId !== quoteId) throw new ApiError('http', 'Your booking changed. Please retry recovery.');
  if (latest?.status === 'REJECTED') {
    try { latest = await cancelRide(latest.id, 'No drivers found; customer ended search', signal); }
    catch (error) {
      const confirmed = await getRide(latest.id, signal).catch(() => null);
      checkOwner();
      if (confirmed?.status === 'CANCELLED' || confirmed?.bookingStatus === 'COMPLETED') latest = confirmed;
      else if (confirmed && confirmed.status !== 'REJECTED') return { kind: 'active', ride: confirmed };
      else throw error;
    }
  }
  checkOwner();
  if (latest && latest.status !== 'CANCELLED' && latest.bookingStatus !== 'COMPLETED') return { kind: 'active', ride: latest };
  await writePendingBooking(uid, null, revision, { value: saved });
  if (signal?.aborted || bookingOwner() !== uid || bookingRevision(uid) !== revision + 1) throw new ApiError('session_changed', 'Your booking changed. Please retry.');
  return { kind: 'released' };
};
