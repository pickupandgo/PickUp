import { NativeLocationModule, LocationEventEmitter, LOCATION_EVENTS } from './NativeLocationModule';
import type { 
  LocationResult, 
  LocationError, 
  PermissionState, 
  LocationConfig, 
  GeofenceRequest,
  GeofenceEvent,
  TrackingState,
  NativeLocationErrorPayload
} from './types';
import type { EmitterSubscription } from 'react-native';

export class LocationService {
  static async setPublishing(enabled: boolean, tripId: string | null): Promise<boolean> {
    return NativeLocationModule.setPublishing(enabled, tripId);
  }
  static async getPermissionStatus(): Promise<PermissionState> {
    return NativeLocationModule.getPermissionStatus();
  }

  static async hasBackgroundPermission(): Promise<boolean> {
    return NativeLocationModule.hasBackgroundPermission();
  }

  static async isProviderEnabled(): Promise<boolean> {
    return NativeLocationModule.isProviderEnabled();
  }

  static async getCurrentLocation(): Promise<LocationResult> {
    try {
      return await NativeLocationModule.getCurrentLocation();
    } catch (e: unknown) {
      throw this.normalizeError(e);
    }
  }

  static async startTracking(config?: LocationConfig): Promise<boolean> {
    try {
      return await NativeLocationModule.startTracking(config);
    } catch (e: unknown) {
      throw this.normalizeError(e);
    }
  }

  static async stopTracking(): Promise<boolean> {
    try {
      return await NativeLocationModule.stopTracking();
    } catch (e: unknown) {
      throw this.normalizeError(e);
    }
  }

  static async isTracking(): Promise<boolean> {
    return NativeLocationModule.isTracking();
  }

  static async startForegroundService(): Promise<boolean> {
    try {
      return await NativeLocationModule.startForegroundService();
    } catch (e: unknown) {
      throw this.normalizeError(e);
    }
  }

  static async stopForegroundService(): Promise<boolean> {
    try {
      return await NativeLocationModule.stopForegroundService();
    } catch (e: unknown) {
      throw this.normalizeError(e);
    }
  }

  static async isForegroundServiceRunning(): Promise<boolean> {
    return NativeLocationModule.isForegroundServiceRunning();
  }

  static async addGeofence(params: GeofenceRequest): Promise<boolean> {
    try {
      return await NativeLocationModule.addGeofence(params);
    } catch (e: unknown) {
      throw this.normalizeError(e);
    }
  }

  static async removeGeofence(geofenceId: string): Promise<boolean> {
    try {
      return await NativeLocationModule.removeGeofence(geofenceId);
    } catch (e: unknown) {
      throw this.normalizeError(e);
    }
  }

  // --- Subscriptions ---

  static subscribeToLocationUpdates(callback: (location: LocationResult) => void): EmitterSubscription {
    return LocationEventEmitter.addListener(LOCATION_EVENTS.LOCATION_UPDATE, callback as any);
  }

  static subscribeToLocationErrors(callback: (error: LocationError) => void): EmitterSubscription {
    return LocationEventEmitter.addListener(LOCATION_EVENTS.LOCATION_ERROR, ((payload: NativeLocationErrorPayload) => {
      callback({ code: payload.code as any, message: payload.message });
    }) as any);
  }

  static subscribeToTrackingState(callback: (state: TrackingState) => void): EmitterSubscription {
    return LocationEventEmitter.addListener(LOCATION_EVENTS.TRACKING_STATE_CHANGED, ((payload: { state: TrackingState }) => {
      callback(payload.state);
    }) as any);
  }

  static subscribeToGeofenceEvents(callback: (event: GeofenceEvent) => void): EmitterSubscription {
    return LocationEventEmitter.addListener(LOCATION_EVENTS.GEOFENCE_EVENT, callback as any);
  }

  static subscribeToGeofenceErrors(callback: (error: LocationError) => void): EmitterSubscription {
    return LocationEventEmitter.addListener(LOCATION_EVENTS.GEOFENCE_ERROR, ((payload: NativeLocationErrorPayload) => {
      callback({ code: payload.code as any, message: payload.message });
    }) as any);
  }

  // --- Helpers ---

  private static normalizeError(error: any): LocationError {
    if (error && error.code) {
      return {
        code: error.code,
        message: error.message || 'An unknown native location error occurred',
      };
    }
    return {
      code: 'UNKNOWN',
      message: error?.message || 'An unknown location error occurred',
    };
  }
}
