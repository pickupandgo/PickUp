import React, { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import { Marker } from 'react-native-maps';
import type { Coordinate } from './types';
import { VehicleMarkerBody } from './VehicleMapMarker';

export interface DriverMarkerProps {
  coordinate: Coordinate;
  heading?: number;
  vehicleType?: string | null;
  size?: number;
}

export const DriverMarker: React.FC<DriverMarkerProps> = ({
  coordinate,
  heading = 0,
  vehicleType,
  size = 52,
}) => {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, Platform.OS === 'android' ? 500 : 200);
    return () => clearTimeout(timer);
  }, [vehicleType]);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
    >
      <VehicleMarkerBody
        vehicleType={vehicleType}
        isLive
        size={size}
        heading={heading}
      />
    </Marker>
  );
};

