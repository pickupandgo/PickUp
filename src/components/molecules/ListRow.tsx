import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography } from '../../theme';

export interface ListRowProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly leading?: React.ReactNode;
  readonly trailing?: React.ReactNode;
  readonly onPress?: () => void;
  readonly compact?: boolean;
}

const ListRow: React.FC<ListRowProps> = ({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  compact = false,
}) => {
  const content = (
    <View style={[styles.container, compact && styles.compact]}>
      {leading && <View style={styles.leading}>{leading}</View>}
      <View style={styles.textContainer}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {subtitle && (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing && <View style={styles.trailing}>{trailing}</View>}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => pressed && styles.pressed}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        {content}
      </Pressable>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: spacing.rowHeightStandard,
    gap: spacing.md,
  },
  compact: {
    paddingVertical: spacing.sm,
    minHeight: spacing.rowHeightSm,
  },
  leading: {
    flexShrink: 0,
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    fontWeight: typography.bodyMd.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  trailing: {
    flexShrink: 0,
  },
  pressed: {
    backgroundColor: colors.surfaceContainerLow,
  },
});

export default ListRow;
