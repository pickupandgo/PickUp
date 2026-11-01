import React from 'react';
import Renderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Alert, Share, Text } from 'react-native';
import Button from '../src/components/atoms/Button';
import CallDriverScreen from '../src/screens/support/CallDriverScreen';
import ShareTrackingSheetScreen from '../src/screens/support/ShareTrackingSheetScreen';
import ChangeProfilePhotoScreen from '../src/screens/profile/ChangeProfilePhotoScreen';
import DriverRatingScreen from '../src/screens/support/DriverRatingScreen';
import WrittenReviewScreen from '../src/screens/support/WrittenReviewScreen';
let mockUser: any = { uid: 'customer-A' };
const mockClear = jest.fn();
let mockContext: any;
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockUser }),
}));
jest.mock('../src/state/BookingContext', () => ({
  useBooking: () => mockContext,
}));
jest.mock('../src/hooks/useTripStatus', () => ({
  useTripStatus: () => ({ trip: undefined }),
}));
const selected = {
  id: 'trip-A',
  externalRef: 'REF-A',
  paymentBookingId: 'booking-A',
  status: 'COMPLETED',
  pickup: { address: 'Private street A' },
  stops: [{ receiver: { phone: 'private-phone' } }],
};
let tree: ReactTestRenderer;
const text = () =>
  tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .flat()
    .join(' ');
beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'customer-A' };
  mockContext = {
    trip: {
      ...selected,
      id: 'trip-B',
      externalRef: 'REF-B',
      paymentBookingId: 'booking-B',
    },
    ride: { paymentBookingId: 'booking-B' },
    clearActiveRide: mockClear,
  };
  jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: Share.dismissedAction });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  if (tree) act(() => tree.unmount());
  jest.restoreAllMocks();
});
it('does not simulate a call and opens the exact selected booking chat', async () => {
  const navigation = { navigate: jest.fn(), goBack: jest.fn() };
  await act(async () => {
    tree = Renderer.create(
      <CallDriverScreen
        navigation={navigation}
        route={{ params: { trip: selected, tripId: selected.id } }}
      />,
    );
  });
  expect(text()).toContain('Driver calling unavailable');
  expect(text()).not.toContain('Calling...');
  act(() => {
    (tree.root.findByType(Button).props as any).onPress();
  });
  expect(navigation.navigate).toHaveBeenCalledWith('ActiveTripChatScreen', {
    bookingId: 'booking-A',
  });
});
it('does not fabricate photo/rating/review success or clear an active booking', async () => {
  const submit = jest.fn();
  for (const Component of [
    ChangeProfilePhotoScreen,
    DriverRatingScreen,
    WrittenReviewScreen,
  ]) {
    await act(async () => {
      tree = Renderer.create(
        React.createElement(Component as any, { onSubmit: submit }),
      );
    });
    expect(text()).toMatch(/not available yet/);
    expect(tree.root.findAllByType(Button)).toHaveLength(0);
    act(() => tree.unmount());
  }
  expect(submit).not.toHaveBeenCalled();
  expect(mockClear).not.toHaveBeenCalled();
});
it('shares historical A reference through the real OS chooser without B or private details', async () => {
  const navigation = { goBack: jest.fn() };
  await act(async () => {
    tree = Renderer.create(
      <ShareTrackingSheetScreen
        navigation={navigation}
        route={{ params: { trip: selected, tripId: selected.id } }}
      />,
    );
  });
  await act(async () => {
    await (tree.root.findByType(Button).props as any).onPress();
  });
  expect(Share.share).toHaveBeenCalledWith({
    message: expect.stringContaining('REF-A'),
  });
  const payload = JSON.stringify((Share.share as jest.Mock).mock.calls[0][0]);
  expect(payload).not.toContain('REF-B');
  expect(payload).not.toContain('Private street');
  expect(payload).not.toContain('private-phone');
  expect(payload).not.toContain('https://');
  expect(navigation.goBack).not.toHaveBeenCalled();
  expect(text()).not.toContain('Copied');
});
it('blocks duplicate taps and reports native sharing failures truthfully', async () => {
  let reject!: (e: Error) => void;
  (Share.share as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    tree = Renderer.create(
      <ShareTrackingSheetScreen route={{ params: { trip: selected } }} />,
    );
  });
  const button = tree.root.findByType(Button);
  act(() => {
    (button.props as any).onPress();
    (button.props as any).onPress();
  });
  expect(Share.share).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('native failure'));
  });
  expect(Alert.alert).toHaveBeenCalledWith(
    'Could not open sharing',
    expect.any(String),
  );
  expect(text()).not.toContain('Shared successfully');
});
it('does not fall back to B when requested A cannot be loaded', async () => {
  await act(async () => {
    tree = Renderer.create(
      <ShareTrackingSheetScreen route={{ params: { tripId: 'missing-A' } }} />,
    );
  });
  expect(tree.root.findByType(Button).props.disabled).toBe(true);
  act(() => {
    (tree.root.findByType(Button).props as any).onPress();
  });
  expect(Share.share).not.toHaveBeenCalled();
  expect(text()).not.toContain('REF-B');
});
it('ignores native sharing failures after signout or unmount', async () => {
  let reject!: (e: Error) => void;
  (Share.share as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  await act(async () => {
    tree = Renderer.create(
      <ShareTrackingSheetScreen route={{ params: { trip: selected } }} />,
    );
  });
  act(() => {
    (tree.root.findByType(Button).props as any).onPress();
  });
  mockUser = null;
  act(() => tree.unmount());
  await act(async () => {
    reject(new Error('late'));
  });
  expect(Alert.alert).not.toHaveBeenCalled();
});
