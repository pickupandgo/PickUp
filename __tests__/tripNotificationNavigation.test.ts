import { authorizeTripNotification } from '../src/services/notifications/TripNotificationNavigation';
import { notificationCopy } from '../src/services/notifications/NotificationCopy';
import type { ActiveTrip } from '../src/types/trip';
const backendId = '00000000-0000-4000-8000-000000000001';
const bookingId = '00000000-0000-4000-8000-000000000002';
const rideId = '00000000-0000-4000-8000-000000000003';
const target = { type: 'TRIP_COMPLETED', backendTripId: backendId, bookingId };
function setup(status = 'IN_TRANSIT') {
  let uid = 'a';
  const deps = {
    uid: () => uid,
    backendTrip: jest.fn(async () => ({ tripId: backendId, bookingId, externalRef: `ENG-${rideId}` })),
    engineTrip: jest.fn(async () => ({ id: 'engine-trip', rideId, paymentTripId: backendId, engineStatus: status } as ActiveTrip)),
    eligibility: jest.fn(async () => ({ eligible: true, approvalStatus: 'APPROVED' })),
  };
  return { deps, changeUser: () => { uid = 'b'; } };
}
test('resolves the current owned active trip rather than interchanging Backend and Engine IDs', async () => {
  const { deps } = setup();
  expect(await authorizeTripNotification(target, deps)).toMatchObject({ screen: 'ActiveTrip', trip: { id: 'engine-trip' } });
  expect(deps.engineTrip).toHaveBeenCalledWith(rideId);
});
test('opens an actual completed-trip summary without requiring current dispatch eligibility', async () => {
  const { deps } = setup('COMPLETED');
  expect(await authorizeTripNotification(target, deps)).toMatchObject({ screen: 'TripCompleted' });
  expect(deps.eligibility).not.toHaveBeenCalled();
});
test('denies cancelled, foreign and ineligible trips', async () => {
  const { deps } = setup('CANCELLED');
  await expect(authorizeTripNotification(target, deps)).rejects.toThrow('cancelled');
  await expect(authorizeTripNotification({ ...target, bookingId: rideId }, deps)).rejects.toThrow('references');
  const active = setup(); active.deps.eligibility.mockResolvedValue({ eligible: false, approvalStatus: 'SUSPENDED' });
  await expect(authorizeTripNotification(target, active.deps)).rejects.toThrow('approval');
});
test('discards authorization after an account change', async () => {
  const { deps, changeUser } = setup();
  deps.backendTrip.mockImplementation(async () => { changeUser(); return { tripId: backendId, bookingId, externalRef: `ENG-${rideId}` }; });
  await expect(authorizeTripNotification(target, deps)).rejects.toThrow('sign-in changed');
});
test('uses safe MultipleRide branding for Driver chat and trip events', () => {
  expect(notificationCopy('NEW_CHAT_MESSAGE')).toEqual({ title: 'MultipleRide • New Message', body: 'You have a new message from your customer.' });
  expect(notificationCopy('TRIP_COMPLETED').body).toBe('Your delivery has been completed.');
});
