import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { colors, shadows } from '../../theme';
import type { GeoPoint } from '../../api/types';
import { getVehicleImage } from '../../utils/vehicleAssets';
import {
  DEFAULT_DELTA,
  FALLBACK_CENTER,
  type MapCanvasProps,
  type MapMarker,
} from './MapCanvas.types';

/**
 * Real map for iOS and Android.
 *
 * Each marker kind renders a themed React view rather than a default pin, so
 * driver and stop icons match the rest of the app: a truck in a white circle
 * for the driver, a filled circle with a stem for pickup and drop.
 */

// Anchor coordinates in [0..1], where (0.5, 1) means "bottom-centre of the
// custom view sits on the geographic point". Truck circles use their centre.

const ANCHORS: Record<MapMarker['kind'], { x: number; y: number }> = {
  pickup: { x: 0.5, y: 0.5 },
  drop: { x: 0.5, y: 0.5 },
  driver: { x: 0.5, y: 0.5 },
  nearby: { x: 0.5, y: 0.5 },
};

const PIN_COLORS: Record<'pickup' | 'drop' | 'nearby', string> = {
  pickup: colors.statusGreen,
  drop: colors.primary,
  nearby: colors.onSurfaceVariant,
};

/** Filled circle with a white ring, hanging from a thin stem. */
const StopPin: React.FC<{ readonly color: string }> = ({ color }) => (
  <View style={styles.pinContainer}>
    <View style={styles.pinVisible}>
      <View style={styles.pinHead}>
        <View style={[styles.pinDot, { backgroundColor: color }]} />
      </View>
      <View style={[styles.pinStem, { backgroundColor: color }]} />
    </View>
    <View style={styles.pinGhost} />
  </View>
);

import { VehicleMarkerBody } from './VehicleMapMarker';

const renderMarkerBody = (marker: MapMarker): React.ReactElement => {
  switch (marker.kind) {
    case 'driver':
      return (
        <VehicleMarkerBody
          vehicleType={marker.vehicleType}
          isLive
          bearing={marker.bearing}
          size={52}
        />
      );
    case 'nearby':
      return (
        <VehicleMarkerBody
          vehicleType={marker.vehicleType}
          isLive={false}
          bearing={marker.bearing}
          size={42}
        />
      );
    default:
      return <StopPin color={PIN_COLORS[marker.kind]} />;
  }
};

const MapCanvas: React.FC<MapCanvasProps> = ({
  style,
  center,
  markers = [],
  polyline,
  fitToMarkers = false,
  showsUserLocation = false,
    onRegionChangeComplete,
    onUserLocationChange,
    scrollEnabled = true,
  forceCenterKey,
  zoomDelta,
  children,
}) => {
  const mapRef = useRef<MapView | null>(null);
  const delta = zoomDelta ?? DEFAULT_DELTA;

  const validMarkers = useMemo<MapMarker[]>(() => {
    if (!Array.isArray(markers)) return [];
    return markers.filter(
      (m): m is MapMarker =>
        Boolean(
          m &&
          m.coordinate &&
          typeof m.coordinate.latitude === 'number' &&
          typeof m.coordinate.longitude === 'number' &&
          Number.isFinite(m.coordinate.latitude) &&
          Number.isFinite(m.coordinate.longitude) &&
          m.coordinate.latitude >= -90 &&
          m.coordinate.latitude <= 90 &&
          m.coordinate.longitude >= -180 &&
          m.coordinate.longitude <= 180
        )
    );
  }, [markers]);

  const validPolyline = useMemo(() => {
    if (!Array.isArray(polyline)) return [];
    return polyline.filter(
      (p) =>
        p &&
        typeof p.latitude === 'number' &&
        typeof p.longitude === 'number' &&
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude) &&
        p.latitude >= -90 &&
        p.latitude <= 90 &&
        p.longitude >= -180 &&
        p.longitude <= 180
    );
  }, [polyline]);

  const initialRegion = useMemo(() => {
    let target = center ?? validMarkers[0]?.coordinate ?? FALLBACK_CENTER;
    if (
      !target ||
      typeof target.latitude !== 'number' ||
      typeof target.longitude !== 'number' ||
      !Number.isFinite(target.latitude) ||
      !Number.isFinite(target.longitude) ||
      target.latitude < -90 ||
      target.latitude > 90 ||
      target.longitude < -180 ||
      target.longitude > 180
    ) {
      target = FALLBACK_CENTER;
    }
    return {
      latitude: target.latitude,
      longitude: target.longitude,
      latitudeDelta: delta,
      longitudeDelta: delta,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit the camera when the SET of markers changes (a new marker appears, or
  // one leaves), not when an existing marker's coordinate updates. Otherwise
  // the driver's 5s location poll would yank the camera back and destroy any
  // pan or zoom the user made. Sorted-ids as the key is stable across renders.
  const markerIdsKey = useMemo(
    () => validMarkers.map((m) => m.id).sort().join('|'),
    [validMarkers]
  );

  useEffect(() => {
    if (!fitToMarkers || !mapRef.current || validMarkers.length === 0) return;

    try {
      if (validMarkers.length === 1) {
        mapRef.current.animateToRegion(
          { ...validMarkers[0].coordinate, latitudeDelta: delta, longitudeDelta: delta },
          400
        );
        return;
      }

      mapRef.current.fitToCoordinates(
        validMarkers.map((m) => ({ latitude: m.coordinate.latitude, longitude: m.coordinate.longitude })),
        { edgePadding: { top: 90, right: 60, bottom: 240, left: 60 }, animated: true }
      );
    } catch (e) {
      console.warn('[MapCanvas] fitToCoordinates failed safely:', e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToMarkers, markerIdsKey]);

  useEffect(() => {
    if (
      fitToMarkers ||
      !center ||
      !mapRef.current ||
      typeof center.latitude !== 'number' ||
      typeof center.longitude !== 'number' ||
      !Number.isFinite(center.latitude) ||
      !Number.isFinite(center.longitude) ||
      center.latitude < -90 ||
      center.latitude > 90 ||
      center.longitude < -180 ||
      center.longitude > 180
    ) {
      return;
    }
    try {
      mapRef.current.animateCamera(
        {
          center: {
            latitude: center.latitude,
            longitude: center.longitude,
          },
          zoom: 17,
        },
        { duration: 800 }
      );
    } catch (e) {
      console.warn('[MapCanvas] animateCamera failed safely:', e);
    }
  }, [center?.latitude, center?.longitude, fitToMarkers, forceCenterKey]);

  // Android has a first-mount rendering quirk where custom marker views appear
  // blank if `tracksViewChanges` is false at mount time. Toggling it on for
  // ~1 s after any marker change re-renders every marker properly, then we
  // turn it off to save CPU. The old code did this only on first mount, so
  // markers added later (a driver coming online 8 s after Home loads) were
  // captured invisible.
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const t = setTimeout(() => setTracking(false), 1_200);
    return () => clearTimeout(t);
  }, [markerIdsKey]);

  return (
    <View style={[styles.container, style]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        showsUserLocation={showsUserLocation}
          onUserLocationChange={onUserLocationChange ? (e) => {
            if (e.nativeEvent.coordinate && Number.isFinite(e.nativeEvent.coordinate.latitude) && Number.isFinite(e.nativeEvent.coordinate.longitude)) {
              onUserLocationChange(e.nativeEvent.coordinate);
            }
          } : undefined}
          showsMyLocationButton={false}
        toolbarEnabled={false}
        scrollEnabled={scrollEnabled}
        zoomEnabled={scrollEnabled}
        onRegionChangeComplete={
          onRegionChangeComplete
            ? (region, details) => {
                if (region && Number.isFinite(region.latitude) && Number.isFinite(region.longitude)) {
                  onRegionChangeComplete({
                    latitude: region.latitude,
                    longitude: region.longitude,
                  } as GeoPoint, details);
                }
              }
            : undefined
        }
      >
        {validMarkers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{
              latitude: marker.coordinate.latitude,
              longitude: marker.coordinate.longitude,
            }}
            title={marker.title}
            description={marker.description}
            anchor={ANCHORS[marker.kind]}

            tracksViewChanges={tracking}
          >
            {renderMarkerBody(marker)}
          </Marker>
        ))}

        {validPolyline.length > 1 && (
          <Polyline
            coordinates={validPolyline.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
            strokeColor={colors.primary}
            strokeWidth={4}
          />
        )}
      </MapView>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { overflow: 'hidden' },

  // Themed stop pin — dark filled dot on a white ring, hanging from a stem.
  pinContainer: {
    alignItems: 'center',
  },
  pinVisible: {
    alignItems: 'center',
  },
  pinGhost: {
    height: 42,
    width: 22,
  },
  pinHead: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  pinDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  pinStem: {
    width: 2,
    height: 22,
    marginTop: -2,
  },

  // 3D Vehicle Marker Styles
  vehicleMarkerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 52,
    height: 52,
  },
  livePulseRing: {
    position: 'absolute',
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primaryContainer,
    opacity: 0.45,
  },
  vehicleMarkerDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    ...shadows.elevated,
  },
  vehicleMarkerDiscLive: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: '#FFFFFF',
  },
  vehicle3dImage: {
    width: 38,
    height: 38,
  },
  driverPin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  nearbyPin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    ...shadows.card,
  },
});

export * from './MapCanvas.types';
export default MapCanvas;

