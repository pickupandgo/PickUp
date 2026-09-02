import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';

export interface BottomSheetProps {
  readonly children: React.ReactNode;
  readonly title?: string;
  readonly showHandle?: boolean;
}

const BottomSheet: React.FC<BottomSheetProps> = ({
  children,
  title,
  showHandle = true,
}) => {
  return (
    <View style={styles.container}>
      {showHandle && (
        <View style={styles.handleWrapper}>
          <View style={styles.handle} />
        </View>
      )}
      {title && (
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{title}</Text>
        </View>
      )}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingBottom: spacing.xxl,
    ...shadows.elevated,
  },
  handleWrapper: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },
  titleContainer: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
});

export default BottomSheet;
