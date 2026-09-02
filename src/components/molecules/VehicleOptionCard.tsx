import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import StatusBadge from '../atoms/StatusBadge';

export interface VehicleOptionCardProps {
  readonly name: string;
  readonly description: string;
  readonly capacity: string;
  readonly estimatedPrice: string;
  readonly eta: string;
  readonly icon: React.ReactNode;
  readonly selected?: boolean;
  readonly onPress?: () => void;
}

const VehicleOptionCard: React.FC<VehicleOptionCardProps> = ({
  name,
  description,
  capacity,
  estimatedPrice,
  eta,
  icon,
  selected = false,
  onPress,
}) => {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${estimatedPrice}, ETA ${eta}`}
      accessibilityState={{ selected }}
    >
      <View style={styles.iconContainer}>{icon}</View>
      <View style={styles.textContainer}>
        <View style={styles.topRow}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.price}>{estimatedPrice}</Text>
        </View>
        <Text style={styles.description} numberOfLines={1}>
          {description}
        </Text>
        <View style={styles.bottomRow}>
          <Text style={styles.capacity}>{capacity}</Text>
          <Text style={styles.eta}>{eta}</Text>
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    gap: spacing.md,
    ...shadows.ghost,
  },
  selected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.surfaceContainerLowest,
  },
  pressed: {
    opacity: 0.92,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: typography.headlineSm.fontSize,
    lineHeight: typography.headlineSm.lineHeight,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  price: {
    fontSize: typography.headlineSm.fontSize,
    lineHeight: typography.headlineSm.lineHeight,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  description: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    fontWeight: typography.bodyMd.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  capacity: {
    fontSize: typography.labelSm.fontSize,
    lineHeight: typography.labelSm.lineHeight,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelSm.fontFamily,
  },
  eta: {
    fontSize: typography.labelSm.fontSize,
    lineHeight: typography.labelSm.lineHeight,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.statusGreen,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default VehicleOptionCard;
