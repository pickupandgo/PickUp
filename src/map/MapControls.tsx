import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { IconButton } from '../components/atoms/IconButton';
import { spacing, shadows, borderRadius, colors } from '../theme';

export interface MapControlsProps {
  onRecenter?: () => void;
  onOverview?: () => void;
  recenterLabel?: string;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  style?: object;
}

export const MapControls: React.FC<MapControlsProps> = ({
  onRecenter,
  onOverview,
  recenterLabel = 'Recenter map',
  onZoomIn,
  onZoomOut,
  style,
}) => {
  return (
    <View style={[styles.container, style]}>
      {onOverview ? (
        <View style={styles.buttonWrapper}>
          <IconButton
            iconName="route"
            size={24}
            color={colors.onSurface}
            onPress={onOverview}
            accessibilityLabel="Show full route"
          />
        </View>
      ) : null}
      {onRecenter && (
        <View style={styles.buttonWrapper}>
          <IconButton
            iconName="my_location"
            size={24}
            color={colors.onSurface}
            onPress={onRecenter}
            accessibilityLabel={recenterLabel}
          />
        </View>
      )}

      {(onZoomIn || onZoomOut) && (
        <View style={styles.zoomGroup}>
          {onZoomIn && (
            <TouchableOpacity
              style={[styles.zoomButton, styles.zoomButtonTop]}
              onPress={onZoomIn}
              accessibilityLabel="Zoom in"
            >
              <IconButton
                iconName="add"
                size={24}
                color={colors.onSurface}
                onPress={onZoomIn}
                accessibilityLabel="Zoom in"
              />
            </TouchableOpacity>
          )}
          {onZoomIn && onZoomOut && <View style={styles.divider} />}
          {onZoomOut && (
            <TouchableOpacity
              style={[styles.zoomButton, styles.zoomButtonBottom]}
              onPress={onZoomOut}
              accessibilityLabel="Zoom out"
            >
              <IconButton
                iconName="remove"
                size={24}
                color={colors.onSurface}
                onPress={onZoomOut}
                accessibilityLabel="Zoom out"
              />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: spacing.containerPadding,
    bottom: spacing.containerPadding,
    alignItems: 'center',
    gap: spacing.xs,
  },
  buttonWrapper: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    ...shadows.md,
  },
  zoomGroup: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    ...shadows.md,
    overflow: 'hidden',
  },
  zoomButton: {
    padding: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButtonTop: {
    borderBottomWidth: 0,
  },
  zoomButtonBottom: {
    borderTopWidth: 0,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginHorizontal: spacing.xs,
  },
});
