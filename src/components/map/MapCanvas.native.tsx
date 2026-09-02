import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { MaterialIcons } from '@expo/vector-icons';
import { colors, shadows } from '../../theme';
import type { GeoPoint } from '../../api/types';
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
  pickup: { x: 0.5, y: 1 },
  drop: { x: 0.5, y: 1 },
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
    <View style={styles.pinHead}>
      <View style={[styles.pinDot, { backgroundColor: color }]} />
    </View>
    <View style={[styles.pinStem, { backgroundColor: color }]} />
  </View>
);

/** Truck glyph on a white disc for the driver's live position. */
const DriverPin: React.FC = () => (
  <View style={styles.driverPin}>
    <MaterialIcons name="local-shipping" size={22} color={colors.primary} />
  </View>
);

/** Smaller, muted disc for other nearby drivers on Home. */
const NearbyDriverPin: React.FC = () => (
  <View style={styles.nearbyPin}>
    <MaterialIcons name="local-shipping" size={16} color={colors.onSurfaceVariant} />
  </View>
);

const renderMarkerBody = (kind: MapMarker['kind']): React.ReactElement => {
  switch (kind) {
    case 'driver':
      return <DriverPin />;
    case 'nearby':
      return <NearbyDriverPin />;
    default:
      return <StopPin color={PIN_COLORS[kind]} />;
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
  scrollEnabled = true,
  zoomDelta,
  children,
}) => {
  const mapRef = useRef<MapView | null>(null);
  const delta = zoomDelta ?? DEFAULT_DELTA;

  const initialRegion = useMemo(() => {
    const target = center ?? markers[0]?.coordinate ?? FALLBACK_CENTER;
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
    () => markers.map((m) => m.id).sort().join('|'),
    [markers]
  );

  useEffect(() => {
    if (!fitToMarkers || !mapRef.current || markers.length === 0) return;

    if (markers.length === 1) {
      mapRef.current.animateToRegion(
        { ...markers[0].coordinate, latitudeDelta: delta, longitudeDelta: delta },
        400
      );
      return;
    }

    mapRef.current.fitToCoordinates(
      markers.map((m) => ({ latitude: m.coordinate.latitude, longitude: m.coordinate.longitude })),
      { edgePadding: { top: 90, right: 60, bottom: 240, left: 60 }, animated: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToMarkers, markerIdsKey]);

  useEffect(() => {
    if (fitToMarkers || !center || !mapRef.current) return;
    mapRef.current.animateToRegion(
      {
        latitude: center.latitude,
        longitude: center.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      },
      400
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.latitude, center?.longitude, fitToMarkers]);

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
        showsMyLocationButton={false}
        toolbarEnabled={false}
        scrollEnabled={scrollEnabled}
        zoomEnabled={scrollEnabled}
        onRegionChangeComplete={
          onRegionChangeComplete
            ? (region) =>
                onRegionChangeComplete({
                  latitude: region.latitude,
                  longitude: region.longitude,
                } as GeoPoint)
            : undefined
        }
      >
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{
              latitude: marker.coordinate.latitude,
              longitude: marker.coordinate.longitude,
            }}
            title={marker.title}
            description={marker.description}
            anchor={ANCHORS[marker.kind]}
            centerOffset={ANCHORS[marker.kind]}
            tracksViewChanges={tracking}
          >
            {renderMarkerBody(marker.kind)}
          </Marker>
        ))}

        {polyline && polyline.length > 1 && (
          <Polyline
            coordinates={polyline.map((p) => ({ latitude: p.latitude, longitude: p.longitude }))}
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

  // Driver marker — truck icon on a white disc.
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
