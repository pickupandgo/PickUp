import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import PreviewVehicleMarker from '../src/components/map/PreviewVehicleMarker.native';
const mockAnimate = jest.fn();
jest.mock('react-native-maps', () => ({ Marker: require('react').forwardRef((props: any, ref: any) => {
  require('react').useImperativeHandle(ref, () => ({ animateMarkerToCoordinate: mockAnimate, redraw: jest.fn() }));
  return require('react').createElement('NativePreviewMarker', props, props.children);
}) }));
it('animates only actual new GPS coordinates and keeps a stable native starting position', () => {
  const previous = Platform.OS;
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
  const marker: any = { id: 'opaque-alias', kind: 'nearby', coordinate: { latitude: 26, longitude: 73 }, vehicleType: 'TWO_WHEELER' };
  let renderer: ReactTestRenderer;
  act(() => { renderer = TestRenderer.create(<PreviewVehicleMarker marker={marker} />); });
  expect(mockAnimate).not.toHaveBeenCalled();
  act(() => { renderer!.update(<PreviewVehicleMarker marker={{ ...marker, coordinate: { latitude: 26.001, longitude: 73 } }} />); });
  expect(mockAnimate).toHaveBeenCalledWith({ latitude: 26.001, longitude: 73 }, 1000);
  act(() => { renderer!.unmount(); });
  Object.defineProperty(Platform, 'OS', { configurable: true, value: previous });
});
