import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { ChatUnreadBadge } from '../src/components/notifications/ChatUnreadBadge';
import { chatNotifications } from '../src/services/notifications/notifications';
const backendTripId = '00000000-0000-4000-8000-000000000001';
test('shows the matching trip badge and removes it after server-confirmed read state', () => {
  const snapshot = jest
    .spyOn(chatNotifications, 'getSnapshot')
    .mockReturnValue({
      backendTripId,
      bookingId: null,
      unreadCount: 2,
      error: null,
    });
  let renderer!: Renderer.ReactTestRenderer;
  try {
    act(() => {
      renderer = Renderer.create(
        <ChatUnreadBadge backendTripId={backendTripId} />,
      );
    });
    expect(
      renderer.root.findAllByProps({
        accessibilityLabel: '2 unread chat messages',
      }),
    ).not.toHaveLength(0);
    snapshot.mockReturnValue({
      backendTripId,
      bookingId: null,
      unreadCount: 0,
      error: null,
    });
    act(() =>
      renderer.update(<ChatUnreadBadge backendTripId={backendTripId} />),
    );
    expect(renderer.toJSON()).toBeNull();
    snapshot.mockReturnValue({
      backendTripId,
      bookingId: null,
      unreadCount: 2,
      error: null,
    });
    act(() =>
      renderer.update(<ChatUnreadBadge backendTripId="another-trip" />),
    );
    expect(renderer.toJSON()).toBeNull();
  } finally {
    if (renderer) act(() => renderer.unmount());
    snapshot.mockRestore();
  }
});
