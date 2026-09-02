import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography } from '../../theme';

export interface LocationInputRowProps {
  readonly label: string;
  readonly address?: string;
  readonly placeholder?: string;
  readonly dotColor?: string;
  readonly onPress?: () => void;
  readonly showConnector?: boolean;
}

const LocationInputRow: React.FC<LocationInputRowProps> = ({
  label,
  address,
  placeholder,
  dotColor = colors.primary,
  onPress,
  showConnector = false,
}) => {
  return (
    <View style={styles.wrapper}>
      <View style={styles.dotColumn}>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        {showConnector && <View style={styles.connector} />}
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.inputArea,
          pressed && onPress ? styles.pressed : null,
        ]}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={styles.label}>{label}</Text>
        <Text
          style={[styles.address, !address && styles.placeholder]}
          numberOfLines={1}
        >
          {address || placeholder || 'Select location'}
        </Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  dotColumn: {
    alignItems: 'center',
    width: 24,
    paddingTop: 6,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  connector: {
    width: 2,
    flex: 1,
    backgroundColor: colors.outlineHairline,
    marginTop: spacing.xs,
    minHeight: 20,
  },
  inputArea: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineHairline,
    gap: 2,
  },
  pressed: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.sm,
  },
  label: {
    fontSize: typography.labelSm.fontSize,
    lineHeight: typography.labelSm.lineHeight,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  address: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  placeholder: {
    color: colors.outlineVariant,
    fontWeight: typography.bodyLg.fontWeight,
  },
});

export default LocationInputRow;
