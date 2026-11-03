import { authorizeChatNotification } from '../src/services/notifications/ChatNotificationNavigation';
import { NotificationError } from '../src/services/notifications/NotificationApi';
const bookingId = '00000000-0000-4000-8000-000000000001',
  backendId = '00000000-0000-4000-8000-000000000002';
function setup() {
  return {
    uid: jest.fn(() => 'driver-a'),
    eligibility: jest.fn(async () => ({
      eligible: true,
      approvalStatus: 'APPROVED',
    })),
    activeTrip: jest.fn(async () => ({
      id: 'engine-trip',
      paymentTripId: backendId,
      status: 'DRIVER_ASSIGNED',
    })),
    summary: jest.fn(async () => ({ bookingId })),
  };
}
test('rechecks eligibility and Engine assignment, then resolves Backend-owned booking before navigating', async () => {
  const deps = setup();
  await expect(authorizeChatNotification(bookingId, deps)).resolves.toEqual({
    bookingId,
    tripId: 'engine-trip',
    paymentTripId: backendId,
  });
  expect(deps.summary).toHaveBeenCalledWith(backendId);
  expect(deps.eligibility.mock.invocationCallOrder[0]).toBeLessThan(
    deps.activeTrip.mock.invocationCallOrder[0],
  );
});
test('requires real Firebase restoration and current approval before resolving notifications', async () => {
  const deps = setup();
  deps.uid.mockReturnValueOnce(undefined as unknown as string);
  await expect(authorizeChatNotification(bookingId, deps)).rejects.toThrow(
    'Sign in',
  );
  expect(deps.summary).not.toHaveBeenCalled();
  deps.eligibility.mockResolvedValueOnce({
    eligible: false,
    approvalStatus: 'SUSPENDED',
  });
  await expect(authorizeChatNotification(bookingId, deps)).rejects.toThrow(
    'approval checks',
  );
  expect(deps.activeTrip).not.toHaveBeenCalled();
});
test.each(['COMPLETED', 'CANCELLED'])(
  'rejects %s Engine trips without opening a conversation',
  async status => {
    const deps = setup();
    deps.activeTrip.mockResolvedValueOnce({
      id: 'engine-trip',
      paymentTripId: backendId,
      status,
    });
    await expect(authorizeChatNotification(bookingId, deps)).rejects.toThrow(
      'No active assigned trip',
    );
    expect(deps.summary).not.toHaveBeenCalled();
  },
);
test.each([403, 410])(
  'rejects backend-owned access failure (%s) without fallback',
  async status => {
    const deps = setup();
    deps.summary.mockRejectedValueOnce(
      new NotificationError('Not available', status),
    );
    await expect(
      authorizeChatNotification(bookingId, deps),
    ).rejects.toMatchObject({ status });
  },
);
test('rejects other booking IDs, missing backend mapping and account switches', async () => {
  const deps = setup();
  deps.summary.mockResolvedValueOnce({ bookingId: backendId });
  await expect(authorizeChatNotification(bookingId, deps)).rejects.toThrow(
    'does not belong',
  );
  deps.activeTrip.mockResolvedValueOnce({
    id: 'engine-trip',
    paymentTripId: '',
    status: 'DRIVER_ASSIGNED',
  });
  await expect(authorizeChatNotification(bookingId, deps)).rejects.toThrow(
    'No active assigned',
  );
  deps.uid.mockReturnValueOnce('driver-a').mockReturnValueOnce('driver-b');
  await expect(authorizeChatNotification(bookingId, deps)).rejects.toThrow(
    'sign-in changed',
  );
});
