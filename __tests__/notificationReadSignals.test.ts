import { ApiChatService } from '../src/services/chat/ChatService';
import { chatNotificationSignals } from '../src/services/notifications/ChatNotificationSignals';
const ref = {
  kind: 'TRIP' as const,
  id: '00000000-0000-4000-8000-000000000001',
};
test('read notifications synchronize only after a valid server acknowledgement', async () => {
  const events = jest.fn();
  const stop = chatNotificationSignals.subscribe(events);
  events.mockClear();
  const transport = jest
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
    .mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ updatedCount: 1 }),
    });
  const service = new ApiChatService({
    user: () => ({
      uid: 'driver-a',
      getIdToken: async () => 'test-only-token',
    }),
    transport,
    baseUrl: () => 'https://backend.test',
  });
  try {
    await expect(service.markAsRead(ref)).rejects.toMatchObject({
      status: 503,
    });
    expect(events).not.toHaveBeenCalled();
    await expect(service.markAsRead(ref)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    expect(events).not.toHaveBeenCalled();
    await service.markAsRead(ref);
    expect(events).toHaveBeenCalledWith({
      type: 'read',
      ref,
      uid: 'driver-a',
      confirmed: true,
    });
  } finally {
    stop();
  }
});
test('a stale chat cleanup cannot hide a newer conversation visibility lease', () => {
  const events = jest.fn();
  const stop = chatNotificationSignals.subscribe(events);
  const first = chatNotificationSignals.viewing(ref, 'driver-a');
  const second = chatNotificationSignals.viewing(
    { ...ref, id: '00000000-0000-4000-8000-000000000002' },
    'driver-a',
  );
  events.mockClear();
  first();
  expect(events).not.toHaveBeenCalled();
  second();
  expect(events).toHaveBeenCalledWith({ type: 'view', view: null });
  stop();
});
