import React from 'react';
import { View, Text, Pressable, StyleSheet, Image, ActivityIndicator, type ImageSourcePropType } from 'react-native';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Skeleton } from '../skeleton';

export interface VehicleOptionCardProps {
  readonly compact?: boolean;
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
  compact = false,
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
        compact && styles.compactContainer,
        isUnavailable && !isQuoteRequest && !selected && styles.cardUnavailable,
        selected && styles.selected,
        compact && selected && styles.compactSelected,
        pressed && !disabled && styles.pressed,
      ]}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${priceAccessibility}${etaAccessibility}`}
      accessibilityState={{ selected, disabled: Boolean(disabled) }}
    >
      <View style={[styles.imageContainer, compact && styles.compactImage]}>
        {image ? (
          <Image source={image} style={styles.image} resizeMode="contain" />
        ) : (
          icon
        )}
      </View>
      <View style={styles.textContainer}>
        <View style={styles.topRow}>
          <Text style={[styles.name, compact && styles.compactName, compact && selected && styles.selectedText]} numberOfLines={compact ? 1 : undefined}>{compact ? name.split(' /')[0] : name}</Text>
          {isLoading ? (
            <View testID={`loading-${name}`}>
              <Skeleton width={56} height={18} borderRadius={4} />
            </View>
          ) : isQuoteRequest ? (
            <Text style={styles.priceQuoteOnRequest}>Quote on request</Text>
          ) : isUnavailable ? (
            <Text style={styles.priceUnavailable} numberOfLines={1}>{unavailableMessage}</Text>
          ) : (
            <Text style={[styles.price, compact && selected && styles.selectedPrice]}>{displayPrice}</Text>
          )}
        </View>
        {!compact && <Text style={styles.description} numberOfLines={1}>
          {description}
        </Text>}
        <View style={styles.bottomRow}>
          <Text style={[styles.capacity, compact && selected && styles.selectedCapacity]}>{capacity}</Text>
          {Boolean(eta) && <Text style={styles.eta}>{eta}</Text>}
        </View>
      </View>
      {compact && <View style={[styles.radio, selected && styles.radioSelected]}>{selected && <View style={styles.radioDot} />}</View>}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  compactContainer: { padding: spacing.sm, minHeight: spacing.rowHeightStandard + spacing.sm, borderRadius: borderRadius.lg, gap: spacing.sm, elevation: 0, shadowOpacity: 0 },
  compactSelected: { borderWidth: 1, borderColor: colors.homePickup, backgroundColor: colors.selectionTint },
  selectedText: { color: colors.homeAction },
  selectedPrice: { color: colors.onSuccessContainer },
  selectedCapacity: { color: colors.statusGreen },
  compactImage: { width: spacing.rowHeightStandard, height: spacing.rowHeightSm + spacing.sm },
  compactName: { ...typography.bodyMd, fontWeight: '600', flex: 1, marginRight: spacing.xs },
  radio: { width: spacing.xl, height: spacing.xl, borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  radioSelected: { borderColor: colors.homePickup, backgroundColor: colors.homePickup },
  radioDot: { width: spacing.sm, height: spacing.sm, borderRadius: borderRadius.full, backgroundColor: colors.onPrimary },
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
