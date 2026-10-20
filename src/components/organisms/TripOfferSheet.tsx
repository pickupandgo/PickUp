import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { SecondaryButton } from '../atoms/SecondaryButton';
import Icon from '../atoms/Icon';
import { useI18n } from '../../i18n';
import type { TripOffer } from '../../types/trip';

export interface TripOfferSheetProps {
  readonly offer: TripOffer;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onExpired?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const TripOfferSheet: React.FC<TripOfferSheetProps> = ({
  offer,
  onAccept,
  onDecline,
  style,
  testID,
}) => {
  const { t } = useI18n();

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.dragHandle} />

      {/* Earnings Card */}
      <View style={styles.earningsCard}>
        <Text style={styles.earningLabel}>{t('home.estEarning')}</Text>
        <Text style={styles.earning}>
          {offer.currency}{offer.estimatedEarning.toLocaleString('en-IN')}
        </Text>
      </View>

      {/* Locations */}
      <View style={styles.locationsContainer}>
        {/* Pickup */}
        <View style={styles.locationRow}>
          <View style={styles.iconContainer}>
            <View style={styles.pickupIcon}>
              <View style={styles.pickupDot} />
            </View>
          </View>
          <View style={styles.locationContent}>
            <Text style={styles.locationLabel}>
              {t('trip.pickup')} • {t('common.minsAway', { count: offer.pickupStop.etaMinutes || 0 })}
            </Text>
            <Text style={styles.addressText} numberOfLines={2}>
              {offer.pickupStop.address}
            </Text>
          </View>
        </View>

        {/* Dropoff */}
        <View style={styles.locationRow}>
          <View style={styles.iconContainer}>
            <View style={styles.dropoffIcon}>
              <Icon name="location_on" style={styles.dropoffPinIcon} />
            </View>
          </View>
          <View style={styles.locationContentRow}>
            <View style={styles.locationContent}>
              <Text style={styles.locationLabel}>{t('trip.dropoff')}</Text>
              <Text style={styles.addressText} numberOfLines={2}>
                {offer.dropStops[0]?.address}
              </Text>
            </View>
            {offer.dropStops.length > 1 && (
              <View style={styles.dropsBadge}>
                <Text style={styles.dropsBadgeText}>
                  {t('trip.firstOfDrops', { count: offer.dropStops.length })}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Trip Details Row */}
      <View style={styles.detailsRow}>
        <View style={styles.detailCard}>
          <Icon name="route" style={styles.detailIcon} />
          <View>
            <Text style={styles.detailLabel}>{t('trip.totalDistance')}</Text>
            <Text style={styles.detailValue}>{t('common.km', { count: offer.totalDistanceKm })}</Text>
          </View>
        </View>
        <View style={styles.detailCard}>
          <Icon name="inventory_2" style={styles.detailIcon} />
          <View>
            <Text style={styles.detailLabel}>{t('trip.loadType')}</Text>
            <Text style={styles.detailValue}>
              {offer.loadType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
            </Text>
          </View>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <SecondaryButton label={t('trip.decline')} onPress={onDecline} style={styles.declineButton} />
        <PrimaryButton label={t('trip.accept')} onPress={onAccept} style={styles.acceptButton} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.lg,
    ...shadows.lg,
  },
  dragHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.outlineVariant,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },
  earningsCard: {
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  earningLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  earning: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  locationsContainer: {
    gap: spacing.containerPadding,
  },
  locationRow: {
    flexDirection: 'row',
    gap: spacing.containerPadding,
  },
  iconContainer: {
    width: 32,
    alignItems: 'center',
    paddingTop: 2,
  },
  pickupIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.onSurface,
  },
  dropoffIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropoffPinIcon: {
    fontSize: 14,
    color: colors.onSurface,
  },
  locationContentRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.unit,
  },
  locationContent: {
    flex: 1,
    gap: 2,
  },
  locationLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  addressText: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  dropsBadge: {
    backgroundColor: '#e8eaf6',
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  dropsBadgeText: {
    ...typography.labelSm,
    color: '#3f51b5',
    fontWeight: '600',
  },
  detailsRow: {
    flexDirection: 'row',
    gap: spacing.containerPadding,
  },
  detailCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    gap: spacing.xs,
  },
  detailIcon: {
    fontSize: 24,
    color: colors.onSurfaceVariant,
  },
  detailLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontSize: 10,
  },
  detailValue: {
    ...typography.bodyMd,
    color: colors.onSurface,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.gutter,
  },
  declineButton: {
    flex: 1,
  },
  acceptButton: {
    flex: 2,
  },
});

export default TripOfferSheet;
