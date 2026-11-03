import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { Animated, Keyboard, Platform, StyleSheet, type KeyboardEvent } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { BottomTabBar } from '@react-navigation/bottom-tabs';
import { SafeAreaInsetsContext, SafeAreaFrameContext } from 'react-native-safe-area-context';
import { MainTabNavigator } from '../src/navigation/MainTabNavigator';
import { colors } from '../src/theme';

jest.mock('../src/services/tracking/TrackingService', () => ({ TrackingService: { getInstance: () => ({ startSession: jest.fn(), detachSession: jest.fn(), stopSession: jest.fn(async () => {}) }) } }));
jest.mock('../src/components/notifications/NotificationRuntime', () => ({ NotificationBanner: () => null }));
jest.mock('../src/components/atoms/Icon', () => 'Icon');
jest.mock('../src/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
jest.mock('../src/navigation/stacks/HomeStack', () => ({ HomeStack: () => null }));
jest.mock('../src/navigation/stacks/TripsStack', () => ({ TripsStack: () => null }));
jest.mock('../src/navigation/stacks/EarningsStack', () => ({ EarningsStack: () => null }));
jest.mock('../src/navigation/stacks/WalletStack', () => ({ WalletStack: () => null }));
jest.mock('../src/navigation/stacks/AccountStack', () => ({ AccountStack: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const View = require('react-native').View;
  const insets = { top: 24, right: 0, bottom: 0, left: 0 };
  const frame = { x: 0, y: 0, width: 390, height: 844 };
  const Insets = ReactModule.createContext(insets);
  const Frame = ReactModule.createContext(frame);
  return { SafeAreaInsetsContext: Insets, SafeAreaFrameContext: Frame,
    useSafeAreaInsets: () => ReactModule.useContext(Insets), useSafeAreaFrame: () => ReactModule.useContext(Frame),
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: View, initialWindowMetrics: { insets, frame } };
});

let view: Renderer.ReactTestRenderer;
const tree = (bottom: number, width = 390, height = 844) => <SafeAreaInsetsContext.Provider value={{ top: 24, right: 0, bottom, left: 0 }}>
  <SafeAreaFrameContext.Provider value={{ x: 0, y: 0, width, height }}>
    <NavigationContainer><MainTabNavigator /></NavigationContainer>
  </SafeAreaFrameContext.Provider>
</SafeAreaInsetsContext.Provider>;
afterEach(async () => { if (view) await act(() => view.unmount()); jest.restoreAllMocks(); });

function renderedBarStyle(bottom: number) {
  // Exercise the real React Navigation BottomTabBar, including its built-in inset padding.
  const bar = view.root.findByType(BottomTabBar);
  const rendered = bar.findAllByType(Animated.View).find(node => {
    const style = StyleSheet.flatten(node.props.style);
    return style?.height === 56 + bottom && style?.borderTopColor === colors.outlineVariant;
  });
  expect(rendered).toBeDefined();
  return StyleSheet.flatten(rendered!.props.style);
}

test.each([[0, 320, 640], [8, 390, 844], [24, 390, 844], [48, 390, 844], [24, 800, 1280], [0, 1280, 800]])(
  'real tab bar reserves inset %i once at %i x %i', async (bottom, width, height) => {
    await act(async () => { view = Renderer.create(tree(bottom, width, height)); });
    const style = renderedBarStyle(bottom);
    expect(style.paddingBottom).toBe(bottom);
    expect(style.height - style.paddingBottom - style.borderTopWidth - 4).toBeGreaterThanOrEqual(48);
    expect(style.position).not.toBe('absolute');
    const bar = view.root.findByType(BottomTabBar);
    expect(bar.props.state.routes.map((route: { name: string }) => route.name)).toEqual(['HomeTab', 'TripsTab', 'EarningsTab', 'WalletTab', 'AccountTab']);
    Object.values(bar.props.descriptors).forEach((descriptor: any) => {
      expect(descriptor.options.tabBarActiveTintColor).toBe(colors.primary);
      expect(descriptor.options.tabBarInactiveTintColor).toBe(colors.outline);
      expect(descriptor.options.tabBarHideOnKeyboard).toBe(true);
    });
  },
);

test('runtime system inset changes resize the mounted bar and preserve the selected tab', async () => {
  await act(async () => { view = Renderer.create(tree(8)); });
  const initial = view.root.findByType(BottomTabBar);
  const wallet = initial.props.state.routes[3];
  await act(() => initial.props.navigation.navigate(wallet.name));
  await act(() => view.update(tree(48)));
  expect(renderedBarStyle(48).paddingBottom).toBe(48);
  const current = view.root.findByType(BottomTabBar).props.state;
  expect(current.routes[current.index].name).toBe('WalletTab');
  await act(() => view.update(tree(0)));
  expect(renderedBarStyle(0).paddingBottom).toBe(0);
});

test('keyboard events hide the tab bar and restore it without treating IME height as a system inset', async () => {
  const callbacks: Record<string, (event: KeyboardEvent) => unknown> = {};
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({ start: callback => callback?.({ finished: true }), stop: jest.fn(), reset: jest.fn() }));
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event, callback) => {
    callbacks[event] = callback;
    return { remove: jest.fn() };
  });
  await act(async () => { view = Renderer.create(tree(24)); });
  const show = callbacks[Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'];
  const hide = callbacks[Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'];
  expect(show).toBeDefined(); expect(hide).toBeDefined();
  await act(() => { show({ endCoordinates: { height: 300 } } as KeyboardEvent); });
  expect(renderedBarStyle(24).paddingBottom).toBe(24);
  expect(view.root.findByType(BottomTabBar).findAllByType(Animated.View).some(node => node.props.pointerEvents === 'none')).toBe(true);
  await act(() => { hide({} as KeyboardEvent); });
  expect(renderedBarStyle(24).height).toBe(80);
  expect(view.root.findByType(BottomTabBar).findAllByType(Animated.View).some(node => node.props.pointerEvents === 'auto')).toBe(true);
});
