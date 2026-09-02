import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';
import type { MapCanvasProps } from './MapCanvas.types';

/**
 * Placeholder map.
 *
 * Metro picks `MapCanvas.native.tsx` on iOS and Android, so this file is what
 * the **web** bundle uses — and it is also what TypeScript resolves for
 * `./MapCanvas`, which keeps the two implementations type-compatible.
 *
 * `react-native-maps` cannot be bundled for web at all: it imports native-only
 * React Native internals, which fails at bundle time rather than at runtime.
 * Keeping it out of this file is what lets `expo export --platform web` and
 * Expo Go both keep working.
 */
const MapCanvas: React.FC<MapCanvasProps> = ({ style, children }) => (
  <View style={[styles.placeholder, style]}>
    <Text style={styles.title}>Map preview unavailable</Text>
    <Text style={styles.body}>Run a native build to see the live map.</Text>
    {children}
  </View>
);

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  title: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  body: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textAlign: 'center',
    marginTop: 2,
  },
});

export * from './MapCanvas.types';
export default MapCanvas;
