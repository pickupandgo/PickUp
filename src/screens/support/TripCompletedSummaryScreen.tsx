import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { mockActiveTrip } from '../../data/mockData';
import { useBooking } from '../../state/BookingContext';
import { useI18n } from '../../i18n';

export interface TripCompletedSummaryScreenProps {
  readonly onBack?: () => void;
  readonly onMore?: () => void;
  readonly onRateDriver?: () => void;
  readonly onViewReceipt?: () => void;
  readonly onBackToHome?: () => void;
}

const TripCompletedSummaryScreen: React.FC<TripCompletedSummaryScreenProps & { navigation?: any }> = ({
  onBack,
  onMore,
  onRateDriver,
  onViewReceipt,
  onBackToHome,
  navigation,
}) => {
  const { clearActiveRide } = useBooking();
  const { t } = useI18n();
  const stops = mockActiveTrip.stops;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
            accessibilityRole="button"
            accessibilityLabel={t('common.goBack')}
          >
            <Feather name="arrow-left" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('trip.completed')}</Text>
          <Pressable
            style={styles.iconButton}
            onPress={() =>
              onMore ? onMore() : navigation?.navigate('ShareTrackingSheetScreen')
            }
            accessibilityRole="button"
            accessibilityLabel={t('common.more')}
          >
            <Feather name="more-vertical" size={24} color={colors.primary} />
          </Pressable>
        </View>
        <View style={styles.headerDivider} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Success Banner */}
        <View style={styles.successBanner}>
          <Feather name="check-circle" size={24} color={colors.onSuccessContainer} />
          <Text style={styles.successBannerText}>{t('trip.completedCaps')}</Text>
        </View>

        {/* High Fidelity Card */}
        <View style={styles.card}>
          {/* Timeline */}
          <View style={styles.timelineContainer}>
            <View style={styles.timelineLine} />
            
            {stops.map((stop, index) => {
              const isFirst = index === 0;
              const isLast = index === stops.length - 1;
              const isPrimaryNode = isFirst || isLast;
              
              let stopLabel = t('booking.dropStop');
              if (isFirst) stopLabel = t('booking.pickup');
              else if (isLast) stopLabel = t('logistics.finalDrop');
              else stopLabel = t('logistics.dropStopWithNumber', { number: index });

              return (
                <View key={index} style={styles.timelineRow}>
                  {/* Node Connector */}
                  <View style={styles.nodeContainer}>
                    {isPrimaryNode ? (
                      <View style={styles.primaryNodeRing}>
                        <View style={styles.primaryNodeCore} />
                      </View>
                    ) : (
                      <View style={styles.secondaryNode} />
                    )}
                  </View>
                  
                  {/* Content */}
                  <View style={styles.contentColumn}>
                    <Text style={styles.stopLabelCaps}>{stopLabel}</Text>
                    <Text style={isPrimaryNode ? styles.stopAddressLg : styles.stopAddressMd}>
                      {stop.address.split(',')[0]} {/* Shorten for UI matching */}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          <View style={styles.cardDivider} />

          {/* Details Grid */}
          <View style={styles.gridContainer}>
            <View style={styles.gridItemHalf}>
              <Text style={styles.gridLabel}>{t('trip.vehicle')}</Text>
              <Text style={styles.gridValueMono}>
                {mockActiveTrip.vehicleType} | {mockActiveTrip.vehicleNumber}
              </Text>
            </View>
            <View style={styles.gridItemHalf}>
              <Text style={styles.gridLabel}>{t('trip.completionTime')}</Text>
              <Text style={styles.gridValueMono}>Oct 24, 2023 • 11:30 AM</Text>
            </View>
            <View style={styles.gridItemFull}>
              <Text style={styles.gridLabel}>{t('common.status')}</Text>
              <View style={styles.paymentStatusRow}>
                <View style={styles.statusDot} />
                <Text style={styles.gridValueMono}>{t('payment.paid')} • {mockActiveTrip.fare}</Text>
              </View>
            </View>
          </View>

          {/* Receipt Info */}
          <View style={styles.receiptInfoBox}>
            <Feather name="file-text" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.receiptInfoText}>{t('payment.digitalReceiptAvailable')}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionContainer}>
          <Pressable
            style={styles.rateButton}
            onPress={() =>
              onRateDriver ? onRateDriver() : navigation?.navigate('DriverRatingScreen')
            }
            accessibilityRole="button"
          >
            <Feather name="star" size={20} color={colors.onPrimary} />
            <Text style={styles.rateButtonText}>{t('trip.rateDriverCaps')}</Text>
          </Pressable>
          
          <Pressable
            style={styles.receiptButton}
            onPress={() =>
              onViewReceipt ? onViewReceipt() : navigation?.navigate('DigitalReceiptScreen')
            }
            accessibilityRole="button"
          >
            <Feather name="file-text" size={20} color={colors.onSecondaryContainer} />
            <Text style={styles.receiptButtonText}>{t('payment.viewReceiptCaps')}</Text>
          </Pressable>
          
          <Pressable
            style={styles.homeButton}
            onPress={() => {
              clearActiveRide();
              if (onBackToHome) onBackToHome();
              else navigation?.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
            }}
            accessibilityRole="button"
          >
            <Text style={styles.homeButtonText}>{t('common.backToHomeCaps')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    zIndex: 40,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  headerDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainerLow,
    width: '100%',
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    gap: spacing.lg,
  },

  // Success Banner
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successContainer,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  successBannerText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSuccessContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },

  // Card
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    ...shadows.card,
    gap: spacing.xl,
  },
  timelineContainer: {
    paddingLeft: spacing.lg,
    position: 'relative',
    gap: spacing.xl,
  },
  timelineLine: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: colors.surfaceContainer,
  },
  timelineRow: {
    position: 'relative',
  },
  nodeContainer: {
    position: 'absolute',
    left: -spacing.lg - 8, // Offset to center on the timeline line
    top: 4,
    width: 16,
    alignItems: 'center',
  },
  primaryNodeRing: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surfaceContainerLowest,
  },
  primaryNodeCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  secondaryNode: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: colors.outline,
    marginTop: 2, // optical alignment
  },
  contentColumn: {},
  stopLabelCaps: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: 4,
  },
  stopAddressLg: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  stopAddressMd: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },

  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.surfaceContainer,
  },

  // Details Grid
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItemHalf: {
    width: '48%',
    marginBottom: spacing.sm,
  },
  gridItemFull: {
    width: '100%',
  },
  gridLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 4,
  },
  gridValueMono: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  paymentStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.successContainer,
  },

  // Receipt Info
  receiptInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceVariant,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
  },
  receiptInfoText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Actions
  actionContainer: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 48,
    borderRadius: borderRadius.full,
  },
  rateButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  receiptButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryContainer,
    height: 48,
    borderRadius: borderRadius.full,
  },
  receiptButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.headlineSm.fontFamily,
  },
  homeButton: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 48,
    marginTop: spacing.xs,
  },
  homeButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default TripCompletedSummaryScreen;
