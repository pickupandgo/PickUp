import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing } from '../../theme';

export interface SettingsRowProps {
  readonly label: string;
  readonly value?: string;
  readonly iconName: string;
  readonly hasChevron?: boolean;
  readonly onPress?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  value,
  iconName,
  hasChevron = true,
  onPress,
  style,
  testID,
}) => {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        pressed && onPress ? styles.pressed : null,
        style,
      ]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View style={styles.iconContainer}>
        <Icon name={iconName} size={22} color={colors.navigationIcon} />
      </View>
      <Text style={styles.label}>{label}</Text>
      {value ? (
        <Text style={styles.value}>{value}</Text>
      ) : null}
      {hasChevron ? (
        <Icon name="chevron_right" style={styles.chevron} />
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.gutter,
    paddingHorizontal: spacing.containerPadding,
    gap: spacing.gutter,
    minHeight: spacing.rowHeightMd,
  },
  pressed: {
    backgroundColor: colors.surfaceContainerLow,
  },
  iconContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerLow,
  },
  icon: {
    fontSize: 22,
    color: colors.onSurfaceVariant,
  },
  label: {
    ...typography.bodyMd,
    color: colors.onSurface,
    flex: 1,
  },
  value: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  chevron: {
    fontSize: 20,
    color: colors.outline,
  },
});

export default SettingsRow;

