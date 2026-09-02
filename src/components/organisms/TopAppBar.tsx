import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';

export interface TopAppBarProps {
  readonly title: string;
  readonly leadingIcon?: React.ReactNode;
  readonly trailingIcon?: React.ReactNode;
  readonly onLeadingPress?: () => void;
  readonly onTrailingPress?: () => void;
  readonly showNotificationDot?: boolean;
  readonly variant?: 'default' | 'transparent';
}

const TopAppBar: React.FC<TopAppBarProps> = ({
  title,
  leadingIcon,
  trailingIcon,
  onLeadingPress,
  onTrailingPress,
  showNotificationDot = false,
  variant = 'default',
}) => {
  return (
    <View
      style={[
        styles.container,
        variant === 'transparent' && styles.transparent,
      ]}
      accessibilityRole="header"
    >
      <View style={styles.leftSection}>
        {leadingIcon && (
          <Pressable
            onPress={onLeadingPress}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Navigate back"
          >
            {leadingIcon}
          </Pressable>
        )}
        <Text style={styles.title}>{title}</Text>
      </View>
      {trailingIcon && (
        <Pressable
          onPress={onTrailingPress}
          style={styles.iconButton}
          accessibilityRole="button"
          accessibilityLabel="Actions"
        >
          {trailingIcon}
          {showNotificationDot && <View style={styles.notificationDot} />}
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineHairline,
    minHeight: spacing.rowHeightStandard,
  },
  transparent: {
    backgroundColor: colors.transparent,
    borderBottomWidth: 0,
  },
  leftSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    fontSize: typography.headlineSm.fontSize,
    lineHeight: typography.headlineSm.lineHeight,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusRed,
    borderWidth: 1,
    borderColor: colors.surface,
  },
});

export default TopAppBar;
