import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { StyleSheet, ScrollView, Text } from 'react-native';
import { DriverMap } from '../src/map/DriverMap';
import { MapControls } from '../src/map/MapControls';
import { TripMapSheet } from '../src/components/organisms/TripMapSheet';
import { TripOfferSheet } from '../src/components/organisms/TripOfferSheet';
import { PrimaryButton } from '../src/components/atoms/PrimaryButton';
import { SecondaryButton } from '../src/components/atoms/SecondaryButton';
jest.mock('../src/components/atoms/Icon', () => 'Icon');
import { viewportInsets, routeCameraPoints } from '../src/map/mapViewport';
import type { RouteData } from '../src/map/types';
const mockFit = jest.fn(),
  mockAnimate = jest.fn();
jest.mock('react-native-maps', () => {
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    PROVIDER_GOOGLE: 'google',
    default: React.forwardRef((props: any, ref: any) => {
      React.useImperativeHandle(ref, () => ({
        fitToCoordinates: mockFit,
        animateCamera: mockAnimate,
      }));
      return React.createElement('NativeMap', props, props.children);
    }),
  };
});
jest.mock('../src/map/MapControls', () => ({ MapControls: 'MapControls' }));
jest.mock('../src/map/DriverMarker', () => ({ DriverMarker: 'DriverMarker' }));
jest.mock('../src/map/PickupMarker', () => ({ PickupMarker: 'PickupMarker' }));
jest.mock('../src/map/DropMarker', () => ({ DropMarker: 'DropMarker' }));
jest.mock('../src/map/RoutePolyline', () => ({
  RoutePolyline: 'RoutePolyline',
}));
const route: RouteData = {
  polylinePoints: [],
  stops: [
    {
      id: 'pickup',
      type: 'pickup',
      coordinate: { latitude: 26.2, longitude: 73.02 },
    },
    {
      id: 'drop',
      type: 'drop',
      coordinate: { latitude: 26.3, longitude: 73.03 },
    },
  ],
};
const driver = { latitude: 26.22, longitude: 73.025 };
const props = {
  currentLocation: driver,
  routeData: route,
  followDriver: true,
  cameraScopeKey: 'trip-a',
  viewportPadding: { top: 80, bottom: 300 },
  testID: 'map',
};
const native = (view: Renderer.ReactTestRenderer) =>
  view.root.findByType('NativeMap' as any);
const mount = async () => {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(<DriverMap {...props} />);
  });
  await act(async () => {
    view.root
      .findAll(
        node =>
          node.props.testID === 'map' &&
          typeof node.props.onLayout === 'function',
      )[0]
      .props.onLayout({ nativeEvent: { layout: { width: 360, height: 640 } } });
    native(view).props.onMapReady();
  });
  return view;
};
beforeEach(() => {
  mockFit.mockClear();
  mockAnimate.mockClear();
});

test('native padding is omitted through layout changes until GoogleMap reports ready', async () => {
  let view!: Renderer.ReactTestRenderer;
  await act(async () => { view = Renderer.create(<DriverMap {...props} />); });
  expect(native(view).props).not.toHaveProperty('mapPadding');
  await act(async () => {
    view.root.findAll(node => node.props.testID === 'map' && typeof node.props.onLayout === 'function')[0]
      .props.onLayout({ nativeEvent: { layout: { width: 360, height: 640 } } });
    view.update(<DriverMap {...props} viewportPadding={{ top: 100, bottom: 240 }} />);
  });
  expect(native(view).props).not.toHaveProperty('mapPadding');
  expect(mockFit).not.toHaveBeenCalled();
  await act(async () => native(view).props.onMapReady());
  expect(native(view).props.mapPadding).toMatchObject({ top: 100, bottom: 240 });
  expect(mockFit).toHaveBeenCalledTimes(1);
  await act(async () => view.unmount());
});
test('initial overview fits the driver and route inside measured padding without a competing follow animation', async () => {
  const view = await mount();
  expect(mockFit).toHaveBeenCalledTimes(1);
  expect(mockFit.mock.calls[0][0]).toContainEqual(driver);
  expect(native(view).props.mapPadding).toMatchObject({ top: 80, bottom: 300 });
  expect(mockAnimate).not.toHaveBeenCalled();
  await act(async () => {
    view.update(
      <DriverMap
        {...props}
        currentLocation={{ ...driver, latitude: 26.23 }}
        routeData={{ ...route }}
      />,
    );
  });
  expect(mockFit).toHaveBeenCalledTimes(1);
  expect(mockAnimate).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
test('follow is explicit; panning pauses GPS/reroute camera updates until overview/recenter is requested', async () => {
  const view = await mount();
  await act(async () => view.root.findByType(MapControls).props.onRecenter());
  expect(mockAnimate).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.update(
      <DriverMap {...props} currentLocation={{ ...driver, latitude: 26.24 }} />,
    );
  });
  expect(mockAnimate).toHaveBeenCalledTimes(2);
  await act(async () => native(view).props.onPanDrag());
  await act(async () => {
    view.update(
      <DriverMap
        {...props}
        currentLocation={{ ...driver, latitude: 26.25 }}
        routeData={{
          ...route,
          bounds: {
            northeast: { latitude: 26.4, longitude: 73.1 },
            southwest: driver,
          },
        }}
      />,
    );
  });
  expect(mockAnimate).toHaveBeenCalledTimes(2);
  expect(mockFit).toHaveBeenCalledTimes(1);
  await act(async () => view.root.findByType(MapControls).props.onOverview());
  expect(mockFit).toHaveBeenCalledTimes(2);
  await act(async () => view.unmount());
});
test('zoom/touch gestures preserve manual ownership and a new trip resets it to overview', async () => {
  const view = await mount();
  await act(async () =>
    native(view).props.onRegionChangeComplete({}, { isGesture: true }),
  );
  await act(async () => {
    view.update(
      <DriverMap {...props} viewportPadding={{ top: 100, bottom: 200 }} />,
    );
  });
  expect(mockFit).toHaveBeenCalledTimes(1);
  await act(async () => {
    view.update(<DriverMap {...props} cameraScopeKey="trip-b" />);
  });
  expect(mockFit).toHaveBeenCalledTimes(2);
  await act(async () => view.unmount());
});
test('changing sheet geometry refits overview, and invalid coordinates cannot reach camera fitting', async () => {
  const view = await mount();
  await act(async () => {
    view.update(
      <DriverMap {...props} viewportPadding={{ top: 80, bottom: 180 }} />,
    );
  });
  expect(mockFit).toHaveBeenCalledTimes(2);
  expect(native(view).props.mapPadding.bottom).toBe(180);
  expect(
    routeCameraPoints({
      ...route,
      polylinePoints: [
        { latitude: NaN, longitude: 73 },
        { latitude: 95, longitude: 0 },
      ],
    }),
  ).toHaveLength(2);
  const small = viewportInsets(320, 480, { top: 120, bottom: 600 });
  expect(small.top + small.bottom).toBeLessThanOrEqual(400);
  await act(async () => view.unmount());
});
test('trip sheet scrolls large content, measures its height, and keeps footer actions when collapsed', async () => {
  const measure = jest.fn();
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(
      <TripMapSheet
        title="Current drop"
        onHeightChange={measure}
        footer={<Text>Open drop</Text>}
      >
        {Array.from({ length: 20 }, (_, i) => (
          <Text key={i}>{`Long address ${i}`}</Text>
        ))}
      </TripMapSheet>,
    );
  });
  expect(view.root.findAllByType(ScrollView)).toHaveLength(1);
  const footer = view.root
    .findAllByType(Text)
    .find(node => node.props.children === 'Open drop')!;
  expect(footer.findAllByType(ScrollView)).toHaveLength(0);
  const layout = view.root.findAll(
    node => typeof node.props.onLayout === 'function',
  )[0];
  await act(async () =>
    layout.props.onLayout({ nativeEvent: { layout: { height: 280 } } }),
  );
  expect(measure).toHaveBeenCalledWith(280);
  await act(async () =>
    view.root
      .findAll(node => node.props.accessibilityLabel === 'Show more map')[0]
      .props.onPress(),
  );
  expect(view.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(
    view.root
      .findAllByType(Text)
      .some(node => node.props.children === 'Open drop'),
  ).toBe(true);
  const style = StyleSheet.flatten(layout.props.style);
  expect(style.maxHeight).toBeGreaterThan(0);
  await act(async () => view.unmount());
});
test('an offer shows every drop in its bounded scroll without burying Accept/Decline inside it', async () => {
  const offer = {
    id: 'offer',
    expiresAt: Date.now() + 30_000,
    customerFarePaise: 6820,
    pickupStop: { id: 'pickup', address: 'Long pickup address' },
    dropStops: Array.from({ length: 8 }, (_, i) => ({
      id: String(i),
      address: `Full drop address ${i}`,
    })),
    totalDistanceKm: 4,
    distanceKind: 'straight_line',
    loadType: 'other',
  } as any;
  let view!: Renderer.ReactTestRenderer;
  await act(async () => {
    view = Renderer.create(
      <TripOfferSheet
        offer={offer}
        onAccept={jest.fn()}
        onDecline={jest.fn()}
      />,
    );
  });
  await act(async () => {
    const details = view.root.findAllByProps({ accessibilityRole: 'button' }).find(node => node.findAllByType(Text).some(text => text.props.children === 'Addresses and stops'));
    details!.props.onPress();
  });
  const scroll = view.root.findByType(ScrollView);
  expect(scroll.findAllByType(PrimaryButton)).toHaveLength(0);
  expect(scroll.findAllByType(SecondaryButton)).toHaveLength(0);
  const texts = scroll
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
  expect(texts).toContain('Full drop address 0');
  expect(texts).toContain('Full drop address 7');
  const accept = view.root.findAllByProps({ accessibilityRole: 'button' }).find(node => node.findAllByType(Text).some(text => text.props.children === 'Accept'));
  expect(accept!.props.disabled).toBe(false);
  expect(scroll.findAllByProps({ accessibilityRole: 'button' })).not.toContain(accept);
  await act(async () => view.unmount());
});
