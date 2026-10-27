import React from 'react';
import { View, Text, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, spacing } from '../../theme';

export interface CameraOverlayProps {
  readonly title: string;
  readonly instructions: string;
  readonly onCapture: () => void;
  readonly onBack?: () => void;
  readonly captureLabel?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const CameraOverlay: React.FC<CameraOverlayProps> = ({
  title,
  instructions,
  onCapture,
  onBack,
  captureLabel = 'CAPTURE',
  style,
  testID,
}) => {
  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      {/* Top bar */}
      <View style={styles.topBar}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={styles.backButtonText}>←</Text>
          </Pressable>
        ) : null}
        <Text style={styles.title}>{title}</Text>
        {onBack ? <View style={styles.backButtonPlaceholder} /> : null}
      </View>

      {/* Framing guide */}
      <View style={styles.framingGuide}>
        <View style={styles.cornerTL} />
        <View style={styles.cornerTR} />
        <View style={styles.cornerBL} />
        <View style={styles.cornerBR} />
      </View>

      {/* Bottom bar */}
      <View style={styles.bottomBar}>
        <Text style={styles.instructions}>{instructions}</Text>
        <Pressable
          onPress={onCapture}
          style={styles.captureButton}
          accessibilityRole="button"
          accessibilityLabel={captureLabel}
        >
          <View style={styles.captureInner} />
        </Pressable>
      </View>
    </View>
  );
};

const cornerBase = {
  position: 'absolute' as const,
  width: 24,
  height: 24,
  borderColor: colors.onPrimary,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onPrimary,
    textAlign: 'center',
    flex: 1,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    color: colors.onPrimary,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 24,
  },
  backButtonPlaceholder: {
    width: 40,
  },
  framingGuide: {
    flex: 1,
    margin: spacing.xl,
    position: 'relative',
  },
  cornerTL: {
    ...cornerBase,
    top: 0,
    left: 0,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  cornerTR: {
    ...cornerBase,
    top: 0,
    right: 0,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  cornerBL: {
    ...cornerBase,
    bottom: 0,
    left: 0,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  cornerBR: {
    ...cornerBase,
    bottom: 0,
    right: 0,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  bottomBar: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
    gap: spacing.containerPadding,
  },
  instructions: {
    ...typography.bodyMd,
    color: colors.onPrimaryContainer,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  captureButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: colors.onPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.onPrimary,
  },
});

export default CameraOverlay;
