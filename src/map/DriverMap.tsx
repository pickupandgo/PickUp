import React, { useRef, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { DriverMarker } from './DriverMarker';
import { PickupMarker } from './PickupMarker';
import { DropMarker } from './DropMarker';
import { RoutePolyline } from './RoutePolyline';
import { MapControls } from './MapControls';
import { colors } from '../theme';
import type { Coordinate, RouteData, MapRegion } from './types';
import {
  validCoordinate,
  routeCameraPoints,
  geometryKey,
  viewportInsets,
  type MapInsets,
} from './mapViewport';
export interface DriverMapProps {
  currentLocation?: Coordinate;
  heading?: number;
  routeData?: RouteData;
  /** Allow the explicit Follow driver control; route overview remains the initial mode. */
  followDriver?: boolean;
  showControls?: boolean;
  cameraScopeKey?: string;
  viewportPadding?: Partial<MapInsets>;
  onMapReady?: () => void;
  onRegionChangeComplete?: (region: MapRegion) => void;
  style?: object;
  testID?: string;
}
type CameraMode = 'overview' | 'follow' | 'center' | 'free';
export const DriverMap: React.FC<DriverMapProps> = ({
  currentLocation,
  heading,
  routeData,
  followDriver = false,
  showControls = true,
  cameraScopeKey,
  viewportPadding,
  onMapReady,
  onRegionChangeComplete,
  style,
  testID,
}) => {
  const mapRef = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [mode, setMode] = useState<CameraMode>('overview');
  const [intent, setIntent] = useState(0);
  const driver = validCoordinate(currentLocation) ? currentLocation : undefined;
  const points = useMemo(() => routeCameraPoints(routeData), [routeData]);
  const geometry = geometryKey(points);
  const padding = useMemo(
    () => viewportInsets(layout.width, layout.height, viewportPadding),
    [
      layout.width,
      layout.height,
      viewportPadding,
    ],
  );
  const initialRegion = useRef({
    ...(driver ?? points[0] ?? { latitude: 26.2389, longitude: 73.0243 }),
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  }).current;
  const last = useRef('');
  const scope = useRef(cameraScopeKey);
  useEffect(() => {
    if (scope.current !== cameraScopeKey) {
      scope.current = cameraScopeKey;
      last.current = '';
      if (mode !== 'overview') {
        setMode('overview');
        return;
      }
    }
    if (
      !ready ||
      !layout.width ||
      !layout.height ||
      !mapRef.current ||
      mode === 'free'
    )
      return;
    const following = mode === 'follow' && followDriver;
    const key = JSON.stringify([
      cameraScopeKey,
      mode,
      intent,
      geometry,
      padding,
      layout,
      !!driver,
      following ? [driver?.latitude, driver?.longitude] : null,
    ]);
    if (last.current === key) return;
    last.current = key;
    // Exactly one camera owner. Native mapPadding already reserves measured overlays;
    // fit's edgePadding adds only a small margin (Android combines the two).
    if (mode === 'overview') {
      const visible = [
        ...new Map(
          [...points, ...(driver ? [driver] : [])].map(point => [
            `${point.latitude}:${point.longitude}`,
            point,
          ]),
        ).values(),
      ];
      if (visible.length > 1)
        mapRef.current.fitToCoordinates(visible, {
          edgePadding: { top: 24, right: 24, bottom: 24, left: 24 },
          animated: true,
        });
      else if (visible[0])
        mapRef.current.animateCamera(
          { center: visible[0], heading: 0, pitch: 0, zoom: 16 },
          { duration: 400 },
        );
    } else if (driver) {
      mapRef.current.animateCamera(
        { center: driver, heading: 0, pitch: 0, zoom: 16 },
        { duration: 400 },
      );
    }
  }, [
    ready,
    driver,
    layout,
    mode,
    intent,
    geometry,
    padding,
    cameraScopeKey,
    driver?.latitude,
    driver?.longitude,
    followDriver,
    points,
  ]);
  const pause = () => setMode('free');
  return (
    <View
      style={[styles.container, style]}
      testID={testID}
      onLayout={event => {
        const { width, height } = event.nativeEvent.layout;
        setLayout(old =>
          old.width === width && old.height === height
            ? old
            : { width, height },
        );
      }}
    >
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        // Fabric's Android padding setter dereferences GoogleMap before onMapReady.
        // Omit the prop until native initialization is complete, including layout updates.
        {...(ready ? { mapPadding: padding } : {})}
        onMapReady={() => {
          setReady(true);
          onMapReady?.();
        }}
        onPanDrag={pause}
        onTouchStart={pause}
        onRegionChangeComplete={(region, details) => {
          if (details?.isGesture) pause();
          onRegionChangeComplete?.(region);
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        mapType="standard"
        userInterfaceStyle="light"
        customMapStyle={mapStyle}
      >
        {/* Route Polyline */}
        {routeData?.polylinePoints && (
          <RoutePolyline
            coordinates={routeData.polylinePoints.filter(validCoordinate)}
          />
        )}

        {/* Stops */}
        {routeData?.stops
          .filter(stop => validCoordinate(stop.coordinate))
          .map(stop => {
            if (stop.type === 'pickup') {
              return (
                <PickupMarker
                  key={stop.id}
                  coordinate={stop.coordinate}
                  label={stop.label}
                  isCurrent={stop.isCurrent}
                />
              );
            } else {
              return (
                <DropMarker
                  key={stop.id}
                  coordinate={stop.coordinate}
                  label={stop.label}
                  isCurrent={stop.isCurrent}
                />
              );
            }
          })}

        {/* Driver location */}
        {driver && <DriverMarker coordinate={driver} heading={heading} />}
      </MapView>
      {showControls ? (
        <MapControls
          onOverview={
            points.length
              ? () => {
                  last.current = '';
                  setMode('overview');
                  setIntent(value => value + 1);
                }
              : undefined
          }
          onRecenter={
            driver
              ? () => {
                  last.current = '';
                  setMode(followDriver ? 'follow' : 'center');
                  setIntent(value => value + 1);
                }
              : undefined
          }
          recenterLabel={followDriver ? 'Follow driver' : 'Recenter map'}
          style={{ bottom: padding.bottom + 16 }}
        />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
});

// Optional: Minimal custom map style to hide POIs, match brand, etc.
const mapStyle = [
  {
    featureType: 'poi',
    elementType: 'labels',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'transit',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
];
