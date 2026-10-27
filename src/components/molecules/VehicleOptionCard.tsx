import React from 'react';
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator, type ImageSourcePropType } from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Skeleton } from '../skeleton';

export interface VehicleOptionCardProps {
  readonly name: string;
  readonly description: string;
  readonly capacity: string;
  readonly estimatedPrice?: string;
  readonly price?: string;
  readonly eta?: string;
  readonly image?: ImageSourcePropType;
  readonly icon?: React.ReactNode;
  readonly selected?: boolean;
  readonly onPress?: () => void;
  readonly isLoading?: boolean;
  readonly isUnavailable?: boolean;
  readonly unavailableMessage?: string;
  readonly isQuoteOnRequest?: boolean;
  readonly disabled?: boolean;
  readonly testID?: string;
}

const VehicleOptionCard: React.FC<VehicleOptionCardProps> = ({
  name,
  description,
  capacity,
  estimatedPrice,
  price,
  eta,
  image,
  icon,
  selected = false,
  onPress,
  isLoading = false,
  isUnavailable = false,
  unavailableMessage = 'Unavailable',
  isQuoteOnRequest = false,
  disabled = false,
  testID,
}) => {
  const isQuoteRequest = Boolean(
    isQuoteOnRequest || price === 'Quote on request' || unavailableMessage === 'Quote on request'
  );
  const displayPrice = price !== undefined ? price : (estimatedPrice ?? '');
  const priceAccessibility = isLoading
    ? 'Calculating fare'
    : isQuoteRequest
      ? 'Quote on request'
      : isUnavailable
        ? unavailableMessage
        : displayPrice;
  const etaAccessibility = eta ? `, ETA ${eta}` : '';

  return (
    <Pressable
      testID={testID}
      style={({ pressed }) => [
        styles.container,
        isUnavailable && !isQuoteRequest && !selected && styles.cardUnavailable,
        selected && styles.selected,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${priceAccessibility}${etaAccessibility}`}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
    >
      <View style={styles.imageContainer}>
        {image ? (
          <Image source={image} style={styles.image} resizeMode="contain" />
        ) : (
          icon
        )}
      </View>
      <View style={styles.textContainer}>
        <View style={styles.topRow}>
          <Text style={styles.name}>{name}</Text>
          {isLoading ? (
            <View testID={`loading-${name}`}>
              <Skeleton width={56} height={18} borderRadius={4} />
            </View>
          ) : isQuoteRequest ? (
            <Text style={styles.priceQuoteOnRequest}>Quote on request</Text>
          ) : isUnavailable ? (
            <Text style={styles.priceUnavailable} numberOfLines={1}>{unavailableMessage}</Text>
          ) : (
            <Text style={styles.price}>{displayPrice}</Text>
          )}
        </View>
        <Text style={styles.description} numberOfLines={1}>
          {description}
        </Text>
        <View style={styles.bottomRow}>
          <Text style={styles.capacity}>{capacity}</Text>
          {Boolean(eta) && <Text style={styles.eta}>{eta}</Text>}
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
    borderColor: colors.outlineVariant,
    backgroundColor: colors.surface,
    gap: spacing.md,
    ...shadows.sm,
  },
  selected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.surfaceContainerLowest,
  },
  pressed: {
    opacity: 0.92,
  },
  imageContainer: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: {
    width: '100%',
    height: '100%',
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
    color: colors.onSurface,
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
  priceQuoteOnRequest: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  priceUnavailable: {
    flexShrink: 1,
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    fontWeight: '600',
    color: colors.error,
    fontFamily: typography.bodyMd.fontFamily,
  },
  cardUnavailable: {
    opacity: 0.75,
  },
});

export default VehicleOptionCard;
