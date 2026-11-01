import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Image, Text, Pressable } from 'react-native';
import PreviewVehicleMarker from './PreviewVehicleMarker.native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { colors, shadows, spacing, typography, borderRadius } from '../../theme';
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
const StopPin: React.FC<{ readonly color: string; readonly label: string }> = ({ color, label }) => (
  <View style={[styles.stopBadge, { backgroundColor: color }]}>
    <Text style={styles.stopBadgeText}>{label}</Text>
  </View>
);

import { VehicleMarkerBody } from './VehicleMapMarker';

const renderMarkerBody = (marker: MapMarker): React.ReactElement => {
  switch (marker.kind) {
    case 'pickup':
      if (marker.label) return <View style={styles.pickupLabelMarker}><View style={styles.pickupLabel}><Text style={styles.pickupLabelText}>{marker.label}</Text></View><View style={styles.pickupLabelStem} /><View style={styles.pickupLabelDot} /></View>;
      return <StopPin color={PIN_COLORS.pickup} label="P" />;
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
      return <StopPin color={PIN_COLORS[marker.kind]} label={String(marker.stopNumber ?? 'D')} />;
  }
};

const MapCanvas: React.FC<MapCanvasProps> = ({
  style,
  appearance = 'default',
  recenterOnLayout = false,
  center,
  markers = [],
  polyline,
  routeStatus,
  onRetryRoute,
  fitToMarkers = false,
  fitRouteOnly = false,
  contentInsets,
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
  const [mapReady, setMapReady] = useState(false);
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [overviewKey, setOverviewKey] = useState(0);
  const paddingTop = contentInsets?.top ?? spacing.xxxl * 3;
  const paddingBottom = contentInsets?.bottom ?? spacing.xxxl * 7;


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

  const fitMarkers = useMemo(() => fitRouteOnly ? validMarkers.filter(marker => marker.kind === 'pickup' || marker.kind === 'drop') : validMarkers, [validMarkers, fitRouteOnly]);

  // Fit the camera when the SET of markers changes (a new marker appears, or
  // one leaves), not when an existing marker's coordinate updates. Otherwise
  // the driver's 5s location poll would yank the camera back and destroy any
  // pan or zoom the user made. Sorted-ids as the key is stable across renders.
  const markerIdsKey = useMemo(
    () => fitMarkers.map((m) => m.id).sort().join('|'),
    [fitMarkers]
  );

  // Fit once when geometry first arrives, on layout/overlay changes, or on
  // explicit overview. GPS polls must not pull the camera away from user pans.
  const routeAvailable = validPolyline.length > 1;
  const fitted = useRef<{ key: string; road: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!fitToMarkers || !mapReady || !layoutHeight || !mapRef.current) return;
    const key = `${markerIdsKey}:${layoutHeight}:${paddingTop}:${paddingBottom}:${overviewKey}`;
    if (fitted.current?.key === key && (fitted.current.road || !routeAvailable)) return;
    const points = [...fitMarkers.map(m => m.coordinate), ...validPolyline];
    if (!points.length) return;
    try {
      mapRef.current.fitToCoordinates(points, {
        edgePadding: { top: paddingTop, bottom: paddingBottom, left: spacing.xxxl, right: spacing.xxxl },
        animated: true,
      });
      fitted.current = { key, road: routeAvailable };
    } catch { /* A later ready/layout event or overview can retry fitting. */ }
    // Deliberately exclude changing GPS/route arrays: preserve manual pan/zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToMarkers, mapReady, layoutHeight, markerIdsKey, routeAvailable, paddingTop, paddingBottom, overviewKey]);

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
    const timer = setTimeout(() => {
    try {
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: center.latitude,
            longitude: center.longitude,
          },
          zoom: appearance === 'home' ? 16 : 17,
        },
        { duration: 800 }
      );
    } catch (e) {
      console.warn('[MapCanvas] animateCamera failed safely:', e);
    }
    }, recenterOnLayout ? 120 : 0);
    return () => clearTimeout(timer);
  }, [center?.latitude, center?.longitude, fitToMarkers, forceCenterKey, mapReady, recenterOnLayout, recenterOnLayout ? layoutHeight : 0]);

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
    <View style={[styles.container, style]} onLayout={e => setLayoutHeight(e.nativeEvent.layout.height)}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onMapReady={() => setMapReady(true)}
        rotateEnabled={false}
        pitchEnabled={false}
        showsPointsOfInterest={appearance === 'home'}
        showsBuildings={false}
        customMapStyle={appearance === 'home' ? HOME_MAP_STYLE : undefined}
        mapPadding={appearance === 'home' && !recenterOnLayout ? { top: 0, left: 0, right: 0, bottom: fitRouteOnly ? spacing.sm : spacing.xxxl * 2 + spacing.sm } : undefined}
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
        {validMarkers.map((marker) => marker.preview ? <PreviewVehicleMarker key={marker.id} marker={marker} /> : (
          <Marker
            key={marker.id}
            coordinate={{
              latitude: marker.coordinate.latitude,
              longitude: marker.coordinate.longitude,
            }}
            image={marker.kind === 'pickup' && marker.label === 'Pickup Point' ? require('../../assets/map/pickup-point.png') : undefined}
            title={marker.title}
            description={marker.description}
            anchor={marker.kind === 'pickup' && marker.label ? { x: 0.5, y: 0.8 } : ANCHORS[marker.kind]}

            tracksViewChanges={tracking}
          >
            {!(marker.kind === 'pickup' && marker.label === 'Pickup Point') && renderMarkerBody(marker)}
          </Marker>
        ))}

        {validPolyline.length > 1 && <>
          <Polyline coordinates={validPolyline} strokeColor={colors.surface} strokeWidth={spacing.sm} lineCap="round" lineJoin="round" zIndex={1} />
          <Polyline coordinates={validPolyline} strokeColor={colors.primary} strokeWidth={spacing.xs + 1} lineCap="round" lineJoin="round" zIndex={2} />
        </>}

      </MapView>
      {fitToMarkers && <Pressable
        accessibilityRole="button" accessibilityLabel="Show full route"
        onPress={() => setOverviewKey(k => k + 1)}
        style={[styles.overview, { bottom: paddingBottom + spacing.md }]}
      ><MaterialIcons name="center-focus-strong" size={spacing.xl} color={colors.primary} /></Pressable>}
      {children}
      {(routeStatus === 'loading' || routeStatus === 'error') && <View style={styles.routeNotice} accessibilityLiveRegion="polite">
        <Text style={styles.routeNoticeText}>{routeStatus === 'loading' ? 'Loading road route...' : 'Road route unavailable. Locations are still shown.'}</Text>
        {routeStatus === 'error' && onRetryRoute && <Pressable onPress={onRetryRoute} accessibilityRole="button"><Text style={styles.routeRetry}>Retry route</Text></Pressable>}
      </View>}
    </View>
  );
};

const HOME_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: colors.surfaceContainerLow }] },
  { elementType: 'labels.text.fill', stylers: [{ color: colors.secondary }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: colors.surface }, { weight: 3 }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: colors.surface }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: colors.surface }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: colors.successContainer }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: colors.secondaryContainer }] },
];
const styles = StyleSheet.create({
  pickupLabelMarker: { width: spacing.xxxl * 5, height: spacing.xxxl * 2 + spacing.lg, alignItems: 'center', paddingTop: spacing.xs },
  pickupLabel: { width: spacing.xxxl * 5 - spacing.sm, height: spacing.xxxl, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.statusGreen, borderRadius: borderRadius.full, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, ...shadows.card },
  pickupLabelText: { ...typography.labelSm, fontWeight: '700', color: colors.onPrimary },
  pickupLabelStem: { width: spacing.xs / 2, height: spacing.lg, backgroundColor: colors.statusGreen },
  pickupLabelDot: { width: spacing.xxl, height: spacing.xxl, borderRadius: borderRadius.full, borderWidth: spacing.xs + 1, borderColor: colors.statusGreen, backgroundColor: colors.surface },
  stopBadge: { minWidth: spacing.xxxl, height: spacing.xxxl, borderRadius: spacing.lg, borderWidth: spacing.xs, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  stopBadgeText: { ...typography.labelSm, fontWeight: '700', color: colors.onPrimary },
  overview: { position: 'absolute', right: spacing.md, width: spacing.xxxl + spacing.lg, height: spacing.xxxl + spacing.lg, borderRadius: spacing.lg, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  container: { overflow: 'hidden' },
  routeNotice: { position: 'absolute', top: spacing.xl, left: spacing.md, right: spacing.md, padding: spacing.sm, backgroundColor: colors.surface, borderRadius: spacing.sm },
  routeNoticeText: { ...typography.bodyMd, color: colors.onSurface },
  routeRetry: { ...typography.labelSm, color: colors.primary, paddingVertical: spacing.sm },

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
