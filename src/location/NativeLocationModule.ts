import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import type { LocationResult, PermissionState, LocationConfig, GeofenceRequest } from './types';

const LINKING_ERROR =
  `The package 'PickUpLocationModule' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const PickUpLocationModule = NativeModules.PickUpLocationModule
  ? NativeModules.PickUpLocationModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export const LocationEventEmitter = new NativeEventEmitter(PickUpLocationModule);

export const LOCATION_EVENTS = {
  LOCATION_UPDATE: 'onLocationUpdate',
  LOCATION_ERROR: 'onLocationError',
  TRACKING_STATE_CHANGED: 'onTrackingStateChanged',
  GEOFENCE_EVENT: 'onGeofenceEvent',
  GEOFENCE_ERROR: 'onGeofenceError',
} as const;

export const NativeLocationModule = {
  getConnectionHealth(): Promise<'CONNECTED' | 'RECONNECTING' | 'STALE' | 'DISCONNECTED'> { return PickUpLocationModule.getConnectionHealth(); },
  getOnlinePreference(): Promise<boolean> { return PickUpLocationModule.getOnlinePreference(); },
  setOnlinePreference(online: boolean): Promise<boolean> { return PickUpLocationModule.setOnlinePreference(online); },
  setPublishing(enabled: boolean, tripId: string | null): Promise<boolean> {
    return PickUpLocationModule.setPublishing(enabled, tripId);
  },
  getPermissionStatus(): Promise<PermissionState> {
    return PickUpLocationModule.getPermissionStatus();
  },

  hasBackgroundPermission(): Promise<boolean> {
    return PickUpLocationModule.hasBackgroundPermission();
  },

  isProviderEnabled(): Promise<boolean> {
    return PickUpLocationModule.isProviderEnabled();
  },

  getCurrentLocation(): Promise<LocationResult> {
    return PickUpLocationModule.getCurrentLocation();
  },

  startTracking(config?: LocationConfig): Promise<boolean> {
    return PickUpLocationModule.startTracking(config || null);
  },

  stopTracking(): Promise<boolean> {
    return PickUpLocationModule.stopTracking();
  },

  isTracking(): Promise<boolean> {
    return PickUpLocationModule.isTracking();
  },

  startForegroundService(): Promise<boolean> {
    return PickUpLocationModule.startForegroundService();
  },

  stopForegroundService(): Promise<boolean> {
    return PickUpLocationModule.stopForegroundService();
  },

  isForegroundServiceRunning(): Promise<boolean> {
    return PickUpLocationModule.isForegroundServiceRunning();
  },

  addGeofence(params: GeofenceRequest): Promise<boolean> {
    return PickUpLocationModule.addGeofence(params);
  },

  removeGeofence(geofenceId: string): Promise<boolean> {
    return PickUpLocationModule.removeGeofence(geofenceId);
  },
};
