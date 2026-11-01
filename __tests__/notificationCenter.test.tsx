import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import NotificationCenterScreen from '../src/screens/support/NotificationCenterScreen';
it('does not present sample driver/payment events as a real inbox', () => {
 let renderer: any;
 act(() => { renderer = TestRenderer.create(<NotificationCenterScreen />); });
 const text = renderer.root.findAllByType(Text).map((node: any) => node.props.children).flat().join(' ');
 expect(text).toContain('Notification history is not available yet.');
 expect(text).not.toContain('Payment successful'); expect(text).not.toContain('Michael');
 act(() => renderer.unmount());
});
it('distinguishes an unavailable inbox from a connected empty list', () => {
 let renderer: any;
 act(() => { renderer = TestRenderer.create(<NotificationCenterScreen notifications={[]} />); });
 const text = renderer.root.findAllByType(Text).map((node: any) => node.props.children).flat().join(' ');
 expect(text).toContain('No notifications in this category.');
 expect(text).not.toContain('not available yet');
 act(() => renderer.unmount());
});
it('delegates supplied notification taps without opening an unrelated active trip', () => {
 const navigate = jest.fn(); const onPress = jest.fn();
 let renderer: any;
 act(() => { renderer = TestRenderer.create(<NotificationCenterScreen navigation={{ navigate }} onNotificationPress={onPress} notifications={[{ id: 'event-A', title: 'Selected booking', description: 'A', icon: 'info', timeText: '', type: 'trip', destination: 'CustomerLiveTrackingScreen' }]} />); });
 const node = renderer.root.findAllByType(Text).find((item: any) => item.props.children === 'Selected booking');
 let button = node.parent; while (button && typeof button.props.onPress !== 'function') button = button.parent;
 act(() => button.props.onPress());
 expect(onPress).toHaveBeenCalledWith('event-A'); expect(navigate).not.toHaveBeenCalled();
 act(() => renderer.unmount());
});
