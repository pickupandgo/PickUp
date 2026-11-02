import {
  ApiChatService,
  type ChatConversation,
} from '../src/services/chat/ChatService';

const backendTrip = '00000000-0000-4000-8000-000000000001';
const bookingId = '00000000-0000-4000-8000-000000000002';
const reference = 'client_message_123456789';
const trip: ChatConversation = { kind: 'TRIP', id: backendTrip };
const booking: ChatConversation = { kind: 'BOOKING', id: bookingId };
const row = (extra = {}) => ({
  id: 'saved',
  bookingId,
  clientMessageId: reference,
  text: 'Hello',
  senderRole: 'DRIVER',
  status: 'sent',
  timestamp: '2026-11-02T10:00:00Z',
  ...extra,
});
const response = (payload: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response);
function setup() {
  let user: { uid: string; getIdToken: jest.Mock } | null = {
    uid: 'driver-a',
    getIdToken: jest.fn(async () => 'test-only-token'),
  };
  const transport = jest.fn();
  const service = new ApiChatService({
    user: () => user,
    transport,
    baseUrl: () => 'https://backend.test',
  });
  return {
    service,
    transport,
    user,
    setUser: (next: typeof user) => {
      user = next;
    },
  };
}
test('uses the backend trip reference and backend origin, never an engine route', async () => {
  const { service, transport } = setup();
  transport.mockResolvedValue(response([]));
  await service.getMessages(trip);
  expect(transport.mock.calls[0][0]).toBe(
    `https://backend.test/v1/trips/${backendTrip}/chat/messages`,
  );
  expect(transport.mock.calls[0][1].headers.Authorization).toBe(
    'Bearer test-only-token',
  );
});
test('coalesces sends and retries the same client reference only after real acknowledgement', async () => {
  const { service, transport } = setup();
  transport
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response(row()));
  await expect(
    service.sendMessage(trip, 'Hello', reference),
  ).rejects.toMatchObject({ status: 503 });
  const results = await Promise.all([
    service.sendMessage(trip, 'Hello', reference),
    service.sendMessage(trip, 'Hello', reference),
  ]);
  expect(results.map(item => item.id)).toEqual(['saved', 'saved']);
  expect(transport).toHaveBeenCalledTimes(2);
  expect(
    transport.mock.calls.map(call => JSON.parse(call[1].body).clientMessageId),
  ).toEqual([reference, reference]);
});
test('refreshes an expired token once without changing the message reference', async () => {
  const { service, transport, user } = setup();
  transport
    .mockResolvedValueOnce(response({}, 401))
    .mockResolvedValueOnce(response(row()));
  await service.sendMessage(trip, 'Hello', reference);
  expect(user!.getIdToken.mock.calls).toEqual([[false], [true]]);
  expect(transport.mock.calls[0][1].body).toBe(transport.mock.calls[1][1].body);
});
test('rejects malformed or unrelated booking acknowledgements and never fakes sent status', async () => {
  const { service, transport } = setup();
  transport
    .mockResolvedValueOnce(response(row({ bookingId: backendTrip })))
    .mockResolvedValueOnce(response(row({ clientMessageId: 'different' })));
  await expect(
    service.sendMessage(booking, 'Hello', reference),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  await expect(
    service.sendMessage(booking, 'Hello', reference),
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});
test('a polling confirmation recovers a lost POST acknowledgement without another send', async () => {
  const { service, transport } = setup();
  let fail!: (reason: Error) => void;
  transport
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValueOnce(response([row()]));
  const pending = service.sendMessage(trip, 'Hello', reference);
  for (let n = 0; n < 8; n++) await Promise.resolve();
  await service.getMessages(trip);
  fail(new Error('lost acknowledgement'));
  await expect(pending).resolves.toMatchObject({ id: 'saved', status: 'sent' });
  expect(transport).toHaveBeenCalledTimes(2);
});
test('closed chat discards cached content and a fresh load contains no old history', async () => {
  const { service, transport } = setup();
  transport
    .mockResolvedValueOnce(response([row()]))
    .mockResolvedValueOnce(response({ error: { code: 'CHAT_CLOSED' } }, 410))
    .mockResolvedValueOnce(response([]));
  expect(await service.getMessages(trip)).toHaveLength(1);
  await expect(service.getMessages(trip)).rejects.toMatchObject({
    status: 410,
  });
  expect(await service.getMessages(trip)).toEqual([]);
});

test('a late send acknowledgement cannot restore content after another request closes the conversation', async () => {
  const { service, transport } = setup();
  let finish!: (value: Response) => void;
  transport
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(response({ error: { code: 'CHAT_CLOSED' } }, 410))
    .mockResolvedValueOnce(response([]));
  const pending = expect(
    service.sendMessage(trip, 'Hello', reference),
  ).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
  for (let n = 0; n < 8; n++) await Promise.resolve();
  await expect(service.getMessages(trip)).rejects.toMatchObject({
    status: 410,
  });
  finish(response(row()));
  await pending;
  expect(await service.getMessages(trip)).toEqual([]);
});
test('logout aborts work and a late previous-account response cannot restore private messages', async () => {
  const { service, transport, setUser } = setup();
  let finish!: (value: Response) => void;
  transport.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const pending = expect(service.getMessages(trip)).rejects.toMatchObject({
    code: 'INTERRUPTED',
  });
  for (let n = 0; n < 8; n++) await Promise.resolve();
  service.clear(true);
  setUser(null);
  finish(response([row()]));
  await pending;
  setUser({ uid: 'driver-b', getIdToken: jest.fn(async () => 'test-only-b') });
  transport.mockResolvedValueOnce(response([]));
  expect(await service.getMessages(trip)).toEqual([]);
});
test('bounds stalled token acquisition and rejects unavailable assignment references', async () => {
  jest.useFakeTimers();
  try {
    const { service, transport, user } = setup();
    user!.getIdToken.mockImplementation(() => new Promise(() => {}));
    const pending = expect(service.getMessages(trip)).rejects.toMatchObject({
      code: 'INTERRUPTED',
    });
    jest.advanceTimersByTime(15001);
    await pending;
    expect(transport).not.toHaveBeenCalled();
    expect(() =>
      service.sendMessage(
        { kind: 'TRIP', id: 'engine-placeholder' },
        'Hello',
        reference,
      ),
    ).toThrow('confirmed driver assignment');
  } finally {
    jest.useRealTimers();
  }
});
