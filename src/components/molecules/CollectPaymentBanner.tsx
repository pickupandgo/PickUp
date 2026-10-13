import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useI18n } from '../../i18n';
import { formatRupees, paiseToRupees } from '../../services/payments/money';
import type { DriverTripDto } from '../../services/payments/collectionsDto';

export interface CollectPaymentBannerProps {
  /** Trips whose payment can be collected now (useCollectableTrips). */
  readonly trips: readonly DriverTripDto[];
  readonly onPress: (trip: DriverTripDto) => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

/** "Collect ₹500": one row per trip with an open pickup or delivery payment. */
export const CollectPaymentBanner: React.FC<CollectPaymentBannerProps> = ({
  trips,
  onPress,
  style,
  testID,
}) => {
  const { t } = useI18n();
  if (trips.length === 0) {
    return null;
  }
  return (
    <View style={[styles.container, style]} testID={testID}>
      {trips.map(trip => {
        const amount = formatRupees(paiseToRupees(trip.payment.farePaise));
        const stage =
          trip.payment.collectionStage === 'PICKUP'
            ? t('collect.stagePickup')
            : t('collect.stageDelivery');
        return (
          <Pressable
            key={trip.tripId}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => onPress(trip)}
            accessibilityRole="button"
            accessibilityLabel={t('collect.banner', { amount })}
            accessibilityHint={t('collect.bannerHint')}
          >
            <View style={styles.icon}>
              <Icon name="payments" size={22} color={colors.onPrimary} />
            </View>
            <View style={styles.texts}>
              <Text style={styles.title}>
                {t('collect.banner', { amount })}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {t('collect.bannerSub', { stage, ref: trip.externalRef })}
              </Text>
            </View>
            <Icon name="chevron_right" size={22} color={colors.onPrimary} />
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary,
  },
  pressed: {
    opacity: 0.88,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: {
    flex: 1,
  },
  title: {
    ...typography.headlineSm,
    color: colors.onPrimary,
  },
  subtitle: {
    ...typography.labelSm,
    color: colors.inversePrimary,
  },
});

export default CollectPaymentBanner;
