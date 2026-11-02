import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { AppState, TextInput } from 'react-native';
import { ActiveTripChatScreen } from '../src/screens/trip/ActiveTripChatScreen';
import { ChatError } from '../src/services/chat/ChatService';

// The first native TextInput/FlatList import is transformed lazily on Windows.
jest.setTimeout(20000);

const mockIdentity = { uid: 'driver-uat' };
const mockChat = {
  getMessages: jest.fn(),
  markAsRead: jest.fn(),
  sendMessage: jest.fn(),
  forget: jest.fn(),
  subscribePrivacy: jest.fn(() => () => {}),
};
let mockTrip: any;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockIdentity }),
  onAuthStateChanged: () => () => {},
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void) =>
    require('react').useEffect(callback, [callback]),
}));
jest.mock('../src/hooks/useActiveTrip', () => ({
  useActiveTrip: () => mockTrip,
}));
jest.mock('../src/services/chat/ChatService', () => {
  const original = jest.requireActual('../src/services/chat/ChatService');
  return { ...original, ChatService: { getInstance: () => mockChat } };
});
jest.mock('../src/components/molecules/AppHeader', () => ({
  AppHeader: () => null,
}));
const engineId = '00000000-0000-4000-8000-000000000001';
const backendId = '00000000-0000-4000-8000-000000000002';
let renderer: Renderer.ReactTestRenderer | undefined;
beforeEach(() => {
  jest.clearAllMocks();
  AppState.currentState = 'active';
  mockTrip = {
    id: engineId,
    paymentTripId: backendId,
    status: 'DRIVER_ASSIGNED',
  };
  mockChat.getMessages.mockResolvedValue([]);
  mockChat.markAsRead.mockResolvedValue(undefined);
});
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
});
const render = async (params: object = { tripId: engineId }) => {
  await act(async () => {
    renderer = Renderer.create(
      <ActiveTripChatScreen
        navigation={{ goBack: jest.fn() }}
        route={{ params }}
      />,
    );
  });
};
test('resolves the backend trip reference instead of using the engine ID', async () => {
  await render();
  expect(mockChat.getMessages).toHaveBeenCalledWith(
    { kind: 'TRIP', id: backendId },
    expect.anything(),
  );
  expect(renderer!.root.findByType(TextInput).props.editable).toBe(true);
});
test('does not show a composer until real backend history authorization succeeds', async () => {
  let finish!: (value: unknown[]) => void;
  mockChat.getMessages.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await render();
  expect(renderer!.root.findByType(TextInput).props.editable).toBe(false);
  await act(async () => finish([]));
  expect(renderer!.root.findByType(TextInput).props.editable).toBe(true);
});
test('does not use an engine ID as a fallback when assignment confirmation is missing', async () => {
  mockTrip.paymentTripId = null;
  await render();
  expect(mockChat.getMessages).not.toHaveBeenCalled();
  expect(renderer!.root.findByType(TextInput).props.editable).toBe(false);
});
test.each([403, 410])(
  'keeps backend-rejected chat closed (%s) and clears private cache',
  async status => {
    mockChat.getMessages.mockRejectedValueOnce(
      new ChatError('CHAT_CLOSED', 'Chat is closed', status),
    );
    await render();
    expect(renderer!.root.findByType(TextInput).props.editable).toBe(false);
    expect(mockChat.forget).toHaveBeenCalledWith({
      kind: 'TRIP',
      id: backendId,
    });
  },
);
test('clears the conversation and disables sends when the engine reports completion', async () => {
  await render();
  mockTrip = { ...mockTrip, status: 'completed', engineStatus: 'COMPLETED' };
  await act(async () =>
    renderer!.update(
      <ActiveTripChatScreen
        navigation={{ goBack: jest.fn() }}
        route={{ params: { tripId: engineId } }}
      />,
    ),
  );
  expect(renderer!.root.findByType(TextInput).props.editable).toBe(false);
  expect(mockChat.forget).toHaveBeenCalled();
});
