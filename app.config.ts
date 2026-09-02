import type { ExpoConfig, ConfigContext } from 'expo/config';

/**
 * Expo config as code so the API base URL and Google Maps key come from the
 * environment instead of being hardcoded in a committed file.
 *
 * Local dev:      put values in `.env` (gitignored) — see `.env.example`
 * EAS build/CI:   set them as EAS environment variables or repo secrets
 *
 * Only non-secret, client-safe values belong in `extra`: everything here is
 * readable in the shipped bundle. The Google key must therefore be locked down
 * by platform + bundle id / package name restrictions in Google Cloud Console.
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Pick Up',
  slug: 'pickup',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  scheme: 'pickup',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.pickup.customer',
    infoPlist: {
      // Required copy for App Store review when requesting location.
      NSLocationWhenInUseUsageDescription:
        'Pick Up uses your location to set your pickup point and find nearby drivers.',
    },
    // Only needed if a screen forces PROVIDER_GOOGLE. Left in so switching
    // from Apple Maps to Google Maps on iOS is a one-line change.
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
    },
  },
  android: {
    package: 'com.pickup.customer',
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
    predictiveBackGestureEnabled: false,
    // react-native-maps uses Google Maps on Android and needs the key natively.
    // Requires "Maps SDK for Android" enabled on the project.
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,
      },
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Pick Up uses your location to set your pickup point and find nearby drivers.',
      },
    ],
    'expo-font',
    'expo-asset',
  ],
  extra: {
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? '',
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '',
  },
});
