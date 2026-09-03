import { useState, useEffect, useCallback } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { LocationService } from './LocationService';
import type { 
  LocationResult, 
  LocationError, 
  PermissionState, 
  TrackingState,
  LocationConfig 
} from './types';

export function useDriverLocation() {
  const [currentLocation, setCurrentLocation] = useState<LocationResult | null>(null);
  const [permissionState, setPermissionState] = useState<PermissionState>('not_determined');
  const [trackingState, setTrackingState] = useState<TrackingState>('idle');
  const [providerEnabled, setProviderEnabled] = useState<boolean>(false);
  const [error, setError] = useState<LocationError | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const pState = await LocationService.getPermissionStatus();
      setPermissionState(pState);
      
      const enabled = await LocationService.isProviderEnabled();
      setProviderEnabled(enabled);

      const isTrack = await LocationService.isTracking();
      // Only override trackingState to idle if it wasn't already stopped or background.
      // The native layer returns a boolean, so we map true to tracking, false to stopped.
      setTrackingState(isTrack ? 'tracking' : 'stopped');
    } catch (e: unknown) {
      setError({ code: 'UNKNOWN', message: e instanceof Error ? e.message : 'Failed to check status' });
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    const locSub = LocationService.subscribeToLocationUpdates((location) => {
      console.log('[NativeLocationDelivery] Received location:', location.latitude, location.longitude);
      setCurrentLocation(location);
      setError(null);
    });

    const errSub = LocationService.subscribeToLocationErrors((err) => {
      setError({ code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } as any);
    });

    const trackSub = LocationService.subscribeToTrackingState((state) => {
      setTrackingState(state);
    });

    return () => {
      locSub.remove();
      errSub.remove();
      trackSub.remove();
    };
  }, []);

  // Seed one immediate fix once permission is granted so maps can center on the
  // driver (and trip routing can compute) even before continuous tracking runs.
  useEffect(() => {
    if (permissionState === 'granted' && !currentLocation) {
      LocationService.getCurrentLocation()
        .then((loc) => {
          setCurrentLocation(loc);
          setError(null);
        })
        .catch(() => {
          /* provider off / no fix yet — surfaced via error/toast elsewhere */
        });
    }
  }, [permissionState, currentLocation]);

  const requestPermission = useCallback(async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'PickUp Driver needs access to your location to track trips, navigate to pickups, and run geofences.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          },
        );
        
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          // If we also need background, we might request ACCESS_BACKGROUND_LOCATION
          // but usually that has to be done separately after fine location is granted.
          const bgGranted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
            {
              title: 'Background Location Permission',
              message: 'PickUp Driver needs background location access to track trips when the app is in the background.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            }
          );
        }
      } catch (err) {
        console.warn('Failed to request permissions:', err);
      }
    }
    await checkStatus();
    return permissionState;
  }, [checkStatus, permissionState]);

  const getCurrentLocation = useCallback(async () => {
    setError(null);
    try {
      const loc = await LocationService.getCurrentLocation();
      setCurrentLocation(loc);
      return loc;
    } catch (err: unknown) {
      setError({ code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } as any);
      throw err;
    }
  }, []);

  const startTracking = useCallback(async (config?: LocationConfig) => {
    setError(null);
    try {
      await LocationService.startTracking(config);
    } catch (err: unknown) {
      setError({ code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } as any);
      throw err;
    }
  }, []);

  const stopTracking = useCallback(async () => {
    try {
      await LocationService.stopTracking();
    } catch (err: unknown) {
      setError({ code: 'UNKNOWN_ERROR', message: err instanceof Error ? err.message : 'Unknown error' } as any);
      throw err;
    }
  }, []);

  return {
    currentLocation,
    permissionState,
    trackingState,
    providerEnabled,
    error,
    requestPermission,
    getCurrentLocation,
    startTracking,
    stopTracking,
    checkStatus
  };
}

