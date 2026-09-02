import type { ViewStyle } from 'react-native';
import type { GeoPoint } from '../../api/types';

/**
 * Shared contract for the map surface.
 *
 * There are two implementations, picked by Metro at bundle time:
 *   MapCanvas.native.tsx  real `react-native-maps` map (iOS + Android)
 *   MapCanvas.tsx         placeholder used on web, and by TypeScript resolution
 *
 * `react-native-maps` imports native-only React Native internals, so it cannot
 * be in the web bundle at all — a runtime guard is not enough, since Metro
 * resolves imports statically.
 */

export interface MapMarker {
  readonly id: string;
  readonly coordinate: GeoPoint;
  readonly title?: string;
  readonly description?: string;
  /** Visual role, so screens don't pass raw colours. */
  readonly kind: 'pickup' | 'drop' | 'driver' | 'nearby';
}

export interface MapCanvasProps {
  readonly style?: ViewStyle;
  /** Camera centre when `markers` is empty or fitting is disabled. */
  readonly center?: GeoPoint;
  readonly markers?: readonly MapMarker[];
  /** Straight line drawn through these points, in order. */
  readonly polyline?: readonly GeoPoint[];
  /** Zoom the camera to include every marker. */
  readonly fitToMarkers?: boolean;
  /** Show the OS "my location" dot. */
  readonly showsUserLocation?: boolean;
  /** Fired when the user finishes panning, for drag-to-pick flows. */
  readonly onRegionChangeComplete?: (point: GeoPoint) => void;
  readonly scrollEnabled?: boolean;
  /**
   * Override the initial camera zoom. Larger deltas show more area; defaults
   * to the street-level `DEFAULT_DELTA`.
   */
  readonly zoomDelta?: number;
  readonly children?: React.ReactNode;
}

/** Jodhpur — matches the engine's seed coordinates. */
export const FALLBACK_CENTER: GeoPoint = { latitude: 26.2389, longitude: 73.0243 };
/** ~2 km wide viewport. Good for tracking and drag-to-pick. */
export const DEFAULT_DELTA = 0.02;
/** ~5 km wide viewport. Good for spotting nearby vehicles. */
export const NEIGHBORHOOD_DELTA = 0.05;
