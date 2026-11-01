import React, { useEffect, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { Marker } from 'react-native-maps';
import type { MapMarker } from './MapCanvas.types';
import { getVehicleMapIcon } from '../../utils/vehicleMapIcons';
import { spacing } from '../../theme';
/** Stable alias + real GPS updates; no synthetic wandering or pulse animation. */
export default function PreviewVehicleMarker({ marker }: { marker: MapMarker }) {
  const ref = useRef<React.ElementRef<typeof Marker>>(null);
  const initial = useRef(marker.coordinate);
  const previous = useRef(marker.coordinate);
  const [tracking, setTracking] = useState(true);
  useEffect(() => { setTracking(true); const timer = setTimeout(() => setTracking(false), 1200); return () => clearTimeout(timer); }, [marker.vehicleType]);
  const size = spacing.rowHeightSm + spacing.sm;
  useEffect(() => {
    const next = marker.coordinate;
    if (next.latitude === previous.current.latitude && next.longitude === previous.current.longitude) return;
    previous.current = next;
    if (Platform.OS === 'android') ref.current?.animateMarkerToCoordinate(next, 1_000);
    else ref.current?.setCoordinates(next);
  }, [marker.coordinate.latitude, marker.coordinate.longitude]);
  return <Marker ref={ref} coordinate={initial.current} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracking} zIndex={0} style={{ width: size, height: size }} title={marker.title}>
    <View collapsable={false} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image source={getVehicleMapIcon(marker.vehicleType)} style={{ width: size, height: size }} resizeMode="contain" fadeDuration={0} onLoad={() => ref.current?.redraw()} />
    </View>
  </Marker>;
}
