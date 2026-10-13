import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';

export interface InlineErrorBannerProps {
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/** A compact error message with an optional retry action, shown above content that is kept. */
export const InlineErrorBanner: React.FC<InlineErrorBannerProps> = ({
  message,
  onRetry,
  retryLabel = 'RETRY',
  style,
  testID,
}) => (
  <View
    style={[styles.container, style]}
    testID={testID}
    accessibilityRole="alert"
  >
    <Icon name="error_outline" size={20} color={colors.onErrorContainer} />
    <Text style={styles.message}>{message}</Text>
    {onRetry ? (
      <Pressable
        onPress={onRetry}
        style={styles.retry}
        accessibilityRole="button"
        accessibilityLabel={retryLabel}
        hitSlop={8}
      >
        <Text style={styles.retryLabel}>{retryLabel}</Text>
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
    backgroundColor: colors.errorContainer,
  },
  message: {
    ...typography.bodyMd,
    flex: 1,
    color: colors.onErrorContainer,
  },
  retry: {
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.unit,
  },
  retryLabel: {
    ...typography.labelCaps,
    color: colors.onErrorContainer,
  },
});

export default InlineErrorBanner;
