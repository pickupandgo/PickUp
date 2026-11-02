import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { FlatList, Text } from 'react-native';
import { NotificationsScreen } from '../src/screens/notifications/NotificationsScreen';
import { NotificationCard } from '../src/components/molecules/NotificationCard';
import { AppHeader } from '../src/components/molecules/AppHeader';
import { notificationInbox, type NotificationHistory } from '../src/services/notifications/NotificationInbox';
jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/components/notifications/NotificationRuntime', () => ({ enablePushAlerts: jest.fn(async () => true) }));
const navigation = { goBack: jest.fn() };
let renderer: Renderer.ReactTestRenderer;
let session = 0;
const render = async () => { await act(async () => { renderer = Renderer.create(<NotificationsScreen navigation={navigation as never} route={{ params: undefined } as never} />); }); };
afterEach(async () => { if (renderer) await act(() => renderer.unmount()); notificationInbox.setSession(null); jest.clearAllMocks(); });
test('missing history renders an honest unavailable state and back goes to the original screen', async () => {
  notificationInbox.setSession(`user-${session++}`); await render();
  const text = renderer.root.findAllByType(Text).map(node => node.props.children);
  expect(text).toContain('Notifications unavailable'); expect(text).toContain('Unread count unavailable');
  expect(renderer.root.findAllByType(NotificationCard)).toHaveLength(0);
  await act(() => renderer.root.findByType(AppHeader).props.onBackPress()); expect(navigation.goBack).toHaveBeenCalled();
});
test('renders only backend records; exposes pagination, refresh, individual and all-read actions', async () => {
  const history: NotificationHistory = { available: true,
    list: jest.fn(async () => ({ items: [{ id: 'backend-id', type: 'BOOKING_CANCELLED', title: 'Actual server title', body: 'Actual server body', readAt: null, createdAt: '2026-11-02T00:30:00Z' }], unreadCount: 9, nextCursor: 'cursor-1' })),
    markRead: jest.fn(async () => {}), markAllRead: jest.fn(async () => {}) };
  notificationInbox.setSession(`user-${session++}`, history); await render();
  const card = renderer.root.findByType(NotificationCard);
  expect(card.props).toMatchObject({ title: 'Actual server title', description: 'Actual server body', category: 'Trip', isRead: false });
  expect(renderer.root.findAllByType(Text).map(node => node.props.children)).toContain('9 unread');
  await act(async () => renderer.root.findByType(FlatList).props.onEndReached()); expect(history.list).toHaveBeenCalledWith('cursor-1');
  await act(async () => renderer.root.findByType(FlatList).props.refreshControl.props.onRefresh());
  await act(async () => renderer.root.findByType(NotificationCard).props.onPress()); expect(history.markRead).toHaveBeenCalledWith('backend-id');
  await act(async () => renderer.root.findAll(node => node.props.accessibilityLabel === 'Mark all as read' && typeof node.props.onPress === 'function')[0].props.onPress());
  expect(history.markAllRead).toHaveBeenCalled();
});
