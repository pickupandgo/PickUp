import { Platform } from 'react-native';
import { LocationService } from '../../location/LocationService';

/** Android owns GPS and authenticated HTTP even when JavaScript is suspended. */
export class TrackingAdapter {
  static async configure(enabled: boolean, tripId: string | null): Promise<void> {
    if (Platform.OS !== 'android') {
      if (enabled) throw new Error('Background location publishing is not supported on this platform.');
      return;
    }
    await LocationService.setPublishing(enabled, tripId);
  }
}
