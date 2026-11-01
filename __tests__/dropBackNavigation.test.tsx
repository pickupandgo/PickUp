import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput, Platform, Keyboard, StyleSheet } from 'react-native';
import Screen from '../src/screens/booking/SelectDropLocationScreen';
import PickupScreen from '../src/screens/booking/SelectLocationScreen';
import Button from '../src/components/atoms/Button';

let mockAuthUser: any = null;
const mockSaveAddress = jest.fn();
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: mockAuthUser }),
  onAuthStateChanged: (_auth: any, callback: any) => { callback(mockAuthUser); return jest.fn(); },
}));
jest.mock('../src/state/savedAddresses', () => ({
  getSavedAddresses: jest.fn(async () => []),
  saveAddress: (...args: any[]) => mockSaveAddress(...args),
  updateSavedAddress: jest.fn(),
}));
jest.mock('../src/state/BookingContext', () => ({ useBooking: () => mockBooking }));
jest.mock('../src/state/recentLocations', () => ({ useRecentLocations: () => ({ locations: [] }), saveRecentLocation: jest.fn() }));
jest.mock('../src/hooks/usePlaceSearch', () => ({ usePlaceSearch: () => ({ setQuery: jest.fn(), suggestions: [], isSearching: false, resolve: jest.fn(), clear: jest.fn() }) }));
jest.mock('../src/components/map/MapCanvas', () => 'MapCanvas');
jest.mock('../src/components/organisms/DraggableBottomSheet', () => {
  const React = require('react');
  return ({ children }: any) => React.createElement(React.Fragment, null, children);
});
const place = { latitude: 26, longitude: 73, address: 'Test destination', receiverName: 'Test Receiver', receiverPhone: '9999999999' };
let mockBooking: any;

it('preserves a confirmed drop on return and replaces it on reconfirm, including reused wrapper params', () => {
  let renderer: ReactTestRenderer;
  const navigate = jest.fn();
  function Harness() {
    const [draft, update] = React.useState<any>({ drops: [], pendingDrop: place });
    mockBooking = {
      draft, customerId: 'test', setPickup: jest.fn(), setSender: jest.fn(),
      addDrop: (drop: any) => update((d: any) => ({ ...d, drops: [...d.drops, drop] })),
      replaceDrop: (index: number, drop: any) => update((d: any) => ({ ...d, drops: d.drops.map((old: any, i: number) => i === index ? drop : old) })),
      setPendingDrop: (pendingDrop: any) => update((d: any) => ({ ...d, pendingDrop })),
    };
    return <Screen navigation={{ navigate }} />;
  }
  act(() => { renderer = TestRenderer.create(<Harness />); });
  const confirm = (): any => renderer!.root.findAllByType(Button).find((b: any) => b.props.label === 'Save and continue')!;
  expect(renderer!.root.findAllByType(TextInput).some((i: any) => i.props.accessibilityLabel === 'Receiver name')).toBe(false);
  act(() => { (renderer!.root.findAllByType(Button).find((b: any) => b.props.label === 'Confirm drop location')!.props as any).onPress(); });
  expect(mockBooking.draft.drops).toHaveLength(0);
  act(() => { confirm().props.onPress(); });
  expect(mockBooking.draft.drops).toHaveLength(1);
  expect((renderer!.root.findAllByType(TextInput) as any[]).find((i: any) => i.props.placeholder === 'Search location')!.props.value).toBe(place.address);
  act(() => { (renderer!.root.findAllByType(TextInput) as any[]).find((i: any) => i.props.accessibilityLabel === 'Receiver name')!.props.onChangeText('Changed Receiver'); });
  act(() => { confirm().props.onPress(); });
  expect(mockBooking.draft.drops).toHaveLength(1);
  expect(mockBooking.draft.drops[0].receiverName).toBe('Changed Receiver');
  expect(navigate).toHaveBeenCalledWith('SelectVehicleScreen');
  act(() => { renderer!.unmount(); });
});


it('pickup also starts without fields; collapsing details retains the draft without saving', () => {
  let renderer: ReactTestRenderer;
  const setSender = jest.fn();
  const setPickup = jest.fn();
  const navigate = jest.fn();
  mockBooking = { draft: { drops: [], pickup: place }, customerId: 'test', setSender, setPickup };
  act(() => { renderer = TestRenderer.create(<PickupScreen navigation={{ navigate }} />); });
  const button = (label: string): any => renderer!.root.findAllByType(Button).find((b: any) => b.props.label === label);
  expect(button('Confirm pickup location')).toBeDefined();
  expect(renderer!.root.findAllByType(TextInput).some((i: any) => i.props.accessibilityLabel === 'Sender name')).toBe(false);
  act(() => { button('Confirm pickup location').props.onPress(); });
  const field = (label: string): any => renderer!.root.findAllByType(TextInput).find((i: any) => i.props.accessibilityLabel === label);
  act(() => { field('Sender name').props.onChangeText('Test Sender'); field('Mobile number').props.onChangeText('9999999999'); });
  act(() => { (renderer!.root as any).findByProps({ accessibilityLabel: 'Back to location selection' }).props.onPress(); });
  expect(setPickup).not.toHaveBeenCalled();
  expect(setSender).not.toHaveBeenCalled();
  act(() => { button('Confirm pickup location').props.onPress(); });
  expect(field('Sender name').props.value).toBe('Test Sender');
  act(() => { button('Save and continue').props.onPress(); });
  expect(setSender).toHaveBeenCalledWith(expect.objectContaining({ name: 'Test Sender', phone: '9999999999' }));
  expect(navigate).toHaveBeenCalledWith('SelectDropLocationScreen');
  act(() => { renderer!.unmount(); });
});

it('uses the signed-in phone, includes house details, and waits for optional address save before committing', async () => {
  mockAuthUser = { uid: 'test', phoneNumber: '+919999999999' };
  const addDrop = jest.fn();
  const navigate = jest.fn();
  mockBooking = { draft: { drops: [], pendingDrop: { ...place, receiverPhone: '' } }, customerId: 'test', addDrop, setPendingDrop: jest.fn() };
  let renderer: ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Screen navigation={{ navigate }} />); });
  const button = (label: string): any => renderer!.root.findAllByType(Button).find((b: any) => b.props.label === label);
  const field = (label: string): any => renderer!.root.findAllByType(TextInput).find((i: any) => i.props.accessibilityLabel === label);
  act(() => { button('Confirm drop location').props.onPress(); });
  act(() => {
    field('House / Apartment / Shop (optional)').props.onChangeText('Shop 4');
    (renderer!.root as any).findByProps({ accessibilityLabel: 'Use my mobile number' }).props.onPress();
    (renderer!.root as any).findByProps({ accessibilityLabel: 'Save address as Shop' }).props.onPress();
  });
  expect(field('Mobile number').props.value).toBe('9999999999');
  mockSaveAddress.mockResolvedValueOnce([]);
  await act(async () => { await button('Save and continue').props.onPress(); });
  expect(addDrop).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  mockSaveAddress.mockImplementationOnce(async (input: any) => [input]);
  await act(async () => { await button('Save and continue').props.onPress(); });
  expect(mockSaveAddress).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Shop', addressLine1: 'Shop 4, Test destination' }), 'test');
  expect(addDrop).toHaveBeenCalledWith(expect.objectContaining({ address: 'Shop 4, Test destination', addressDetails: 'Shop 4', receiverPhone: '9999999999' }));
  act(() => { renderer!.unmount(); });
  mockAuthUser = null;
});

it('saving an edited drop returns directly to vehicle selection without another confirmation screen', async () => {
  const replaceDrop = jest.fn();
  const popTo = jest.fn();
  mockBooking = { draft: { drops: [place, { ...place, address: 'Second drop' }] }, customerId: 'test', replaceDrop };
  let renderer: ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Screen route={{ params: { mode: 'edit', editTarget: { type: 'drop', index: 1 } } }} navigation={{ popTo }} />); });
  const button = (label: string): any => renderer!.root.findAllByType(Button).find((b: any) => b.props.label === label);
  act(() => { button('Confirm drop location').props.onPress(); });
  await act(async () => { await button('Save and continue').props.onPress(); });
  expect(replaceDrop).toHaveBeenCalledWith(1, expect.objectContaining({ address: 'Second drop' }));
  expect(popTo).toHaveBeenCalledWith('SelectVehicleScreen');
  expect(button('Done Editing')).toBeUndefined();
  act(() => { renderer!.unmount(); });
});

it('Android keyboard layout does not add a second keyboard-height spacer or bounce past form content', () => {
  const previousOS = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  let onShow: any;
  const listener = jest.spyOn(Keyboard, 'addListener').mockImplementation((event: any, callback: any) => {
    if (event === 'keyboardDidShow') onShow = callback;
    return { remove: jest.fn() } as any;
  });
  mockBooking = { draft: { drops: [], pendingDrop: place }, customerId: 'test' };
  let renderer: ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<Screen />); });
  const scroll = (): any => (renderer!.root as any).findByProps({ testID: 'location-details-scroll' });
  const padding = StyleSheet.flatten(scroll().props.contentContainerStyle).paddingBottom;
  act(() => { onShow({ endCoordinates: { height: 300 } }); });
  expect(StyleSheet.flatten(scroll().props.contentContainerStyle).paddingBottom).toBe(padding);
  expect(scroll().props.automaticallyAdjustKeyboardInsets).toBe(false);
  expect(scroll().props.overScrollMode).toBe('never');
  expect(scroll().props.bounces).toBe(false);
  act(() => { renderer!.unmount(); });
  listener.mockRestore();
  Object.defineProperty(Platform, 'OS', { configurable: true, value: previousOS });
});
