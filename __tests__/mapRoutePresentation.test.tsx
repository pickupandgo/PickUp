import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import MapCanvas from '../src/components/map/MapCanvas.native';
const mockFit = jest.fn();
jest.mock('react-native-maps', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFit }));
      return React.createElement('NativeMap', props, props.children);
    }),
    Marker: 'Marker', Polyline: 'Polyline',
  };
});
jest.mock('../src/components/map/VehicleMapMarker', () => ({ VehicleMarkerBody: 'VehicleMarkerBody' }));
it('waits for native readiness, fits road bends above the panel, and preserves pans across GPS refreshes', () => {
  let renderer: ReactTestRenderer;
  const pickup = { latitude: 26, longitude: 73 };
  const driver = { latitude: 26.01, longitude: 73.01 };
  const bend = { latitude: 26.02, longitude: 73.05 };
  const props: any = { fitToMarkers: true, markers: [{ id: 'pickup', kind: 'pickup', coordinate: pickup }, { id: 'driver', kind: 'driver', coordinate: driver }], contentInsets: { top: 80, bottom: 280 } };
  act(() => { renderer = TestRenderer.create(<MapCanvas {...props} />); });
  expect(mockFit).not.toHaveBeenCalled();
  const map = (): any => renderer!.root.findByType('NativeMap' as any);
  act(() => {
    (renderer!.root.findAllByType(View)[0].props as any).onLayout({ nativeEvent: { layout: { height: 800 } } });
    map().props.onMapReady();
  });
  expect(mockFit).toHaveBeenCalledTimes(1);
  act(() => { renderer!.update(<MapCanvas {...props} polyline={[driver, bend, pickup]} />); });
  expect(mockFit).toHaveBeenLastCalledWith(expect.arrayContaining([bend]), expect.objectContaining({ edgePadding: expect.objectContaining({ bottom: 280 }) }));
  expect(mockFit).toHaveBeenCalledTimes(2);
  act(() => { renderer!.update(<MapCanvas {...props} polyline={undefined} />); });
  act(() => { renderer!.update(<MapCanvas {...props} polyline={[{ ...driver, latitude: 26.012 }, bend, pickup]} />); });
  expect(mockFit).toHaveBeenCalledTimes(2);
  act(() => { (renderer!.root as any).findByProps({ accessibilityLabel: 'Show full route' }).props.onPress(); });
  expect(mockFit).toHaveBeenCalledTimes(3);
  expect(map().props.rotateEnabled).toBe(false);
  act(() => { renderer!.unmount(); });
});
