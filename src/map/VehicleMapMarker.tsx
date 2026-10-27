import React, { useState, useEffect, useMemo } from 'react';
import { View, Image, StyleSheet, Platform, Animated, Easing } from 'react-native';
import { Marker } from 'react-native-maps';
import type { Coordinate } from './types';
import { getVehicleMapIcon, getVehicleCategoryDisplayName } from '../utils/vehicleMapIcons';
import { colors, shadows } from '../theme';

export interface VehicleMapMarkerProps {
  readonly coordinate: Coordinate;
  readonly vehicleType?: string | null;
  readonly heading?: number;
  readonly isLive?: boolean;
  readonly title?: string;
  readonly description?: string;
  readonly size?: number;
  readonly testID?: string;
}

export interface VehicleMarkerBodyProps {
  readonly vehicleType?: string | null;
  readonly isLive?: boolean;
  readonly size?: number;
  readonly heading?: number;
  readonly bearing?: number;
}

/**
 * Visual body of the 3D vehicle marker for the Driver App.
 * Keeps the 3D isometric vehicle upright and distinct with a subtle elevated base
 * and an optional pulsing live indicator.
 */
export const VehicleMarkerBody: React.FC<VehicleMarkerBodyProps> = React.memo(({
  vehicleType,
  isLive = true,
  size = 52,
}) => {
  const iconSource = useMemo(() => getVehicleMapIcon(vehicleType), [vehicleType]);
  const pulseAnim = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (!isLive) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [isLive, pulseAnim]);

  const discSize = size - 6;
  const imageSize = size - 10;

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.45],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.45, 0.2, 0],
  });

  return (
    <View style={[styles.container, { width: size + 12, height: size + 12 }]}>
      {isLive && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              width: discSize + 14,
              height: discSize + 14,
              borderRadius: (discSize + 14) / 2,
              transform: [{ scale: pulseScale }],
              opacity: pulseOpacity,
            },
          ]}
        />
      )}
      <View
        style={[
          styles.disc,
          isLive && styles.discLive,
          {
            width: discSize,
            height: discSize,
            borderRadius: discSize / 2,
          },
        ]}
      >
        <Image
          source={iconSource}
          style={{ width: imageSize, height: imageSize }}
          resizeMode="contain"
          fadeDuration={0}
        />
      </View>
    </View>
  );
});

/**
 * Complete react-native-maps Marker for rendering 3D vehicles on Driver App maps.
 */
export const VehicleMapMarker: React.FC<VehicleMapMarkerProps> = ({
  coordinate,
  vehicleType,
  heading,
  isLive = true,
  title,
  description,
  size = 52,
  testID,
}) => {
  // Allow enough frames on Android for the image to decode into the native hardware layer
  const [tracksViewChanges, setTracksViewChanges] = useState(true);

  useEffect(() => {
    setTracksViewChanges(true);
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, Platform.OS === 'android' ? 500 : 200);
    return () => clearTimeout(timer);
  }, [vehicleType, isLive]);

  const defaultTitle = title || getVehicleCategoryDisplayName(vehicleType);

  return (
    <Marker
      coordinate={{
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      }}
      title={defaultTitle}
      description={description}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracksViewChanges}
      testID={testID}
    >
      <VehicleMarkerBody
        vehicleType={vehicleType}
        isLive={isLive}
        size={size}
        heading={heading}
      />
    </Marker>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    backgroundColor: colors.primary,
  },
  disc: {
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    ...shadows.sm,
  },
  discLive: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: '#FFFFFF',
  },
});

export default VehicleMapMarker;
