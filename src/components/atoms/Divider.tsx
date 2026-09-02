import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme';

export interface DividerProps {
  readonly label?: string;
  readonly variant?: 'hairline' | 'standard';
}

const Divider: React.FC<DividerProps> = ({
  label,
  variant = 'hairline',
}) => {
  if (label) {
    return (
      <View style={styles.labelContainer}>
        <View style={[styles.line, variant === 'standard' && styles.lineStandard]} />
        <Text style={styles.labelText}>{label}</Text>
        <View style={[styles.line, variant === 'standard' && styles.lineStandard]} />
      </View>
    );
  }

  return (
    <View
      style={[styles.simpleLine, variant === 'standard' && styles.lineStandard]}
      accessibilityRole="none"
    />
  );
};

const styles = StyleSheet.create({
  labelContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: colors.outlineHairline,
  },
  lineStandard: {
    backgroundColor: colors.outlineVariant,
  },
  simpleLine: {
    height: 1,
    backgroundColor: colors.outlineHairline,
    width: '100%',
  },
  labelText: {
    fontSize: typography.labelSm.fontSize,
    lineHeight: typography.labelSm.lineHeight,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.outlineVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default Divider;
