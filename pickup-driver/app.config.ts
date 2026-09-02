import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Pick Up Driver — separate app from the customer app.
 *
 * Distinct bundle id / package name so both can be installed on the same phone
 * and built independently. Points at the same Pickup-Go-Core-Engine backend.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Pick Up Driver',
  slug: 'pickup-driver',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  scheme: 'pickupdriver',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.pickup.driver',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Pick Up Driver shares your location so customers can see you and find nearby drivers.',
    },
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    },
  },
  android: {
    package: 'com.pickup.driver',
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    // react-native-maps uses Google Maps on Android and needs the key natively.
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
  },
  plugins: [
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Pick Up Driver shares your location so customers can see you.',
      },
    ],
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  },
});
