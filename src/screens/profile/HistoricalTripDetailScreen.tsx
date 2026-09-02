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
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { mockActiveTrip } from '../../data/mockData';

export interface HistoricalTripDetailScreenProps {
  readonly onBack?: () => void;
  readonly onMore?: () => void;
  readonly onDownloadInvoice?: () => void;
  readonly onNeedHelp?: () => void;
  readonly onRateTrip?: () => void;
}

const HistoricalTripDetailScreen: React.FC<HistoricalTripDetailScreenProps & { navigation?: any }> = ({
  onBack,
  onMore,
  onDownloadInvoice,
  onNeedHelp,
  onRateTrip,
  navigation,
}) => {
  const stops = mockActiveTrip.stops;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Trip Details</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onMore ? onMore() : navigation?.navigate('ShareTrackingSheetScreen'))}
        >
          <Feather name="more-vertical" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status & Meta */}
        <View style={styles.statusSection}>
          <View style={styles.statusCard}>
            <Feather name="check-circle" size={24} color={colors.primary} />
            <View>
              <Text style={styles.statusTitle}>Trip Completed</Text>
              <Text style={styles.statusTime}>Oct 24, 2023 • 11:30 AM</Text>
            </View>
          </View>
          
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>TRACKING ID</Text>
            <Text style={styles.metaValue}>#{mockActiveTrip.id}</Text>
          </View>
        </View>

        {/* Route Timeline */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Route Information</Text>
          
          <View style={styles.timelineContainer}>
            <View style={styles.timelineLine} />
            
            {stops.map((stop, index) => {
              const isFirst = index === 0;
              const isLast = index === stops.length - 1;
              const isPrimaryNode = isFirst || isLast;
              
              let stopLabel = 'Drop';
              if (isFirst) stopLabel = 'Pickup';
              else if (isLast) stopLabel = 'Final Drop';
              else stopLabel = `Drop ${index}`;
              
              if (stop.contactName && !isFirst) {
                stopLabel += ` • ${stop.contactName.split(' ')[0]}`;
              }

              return (
                <View key={index} style={styles.timelineRow}>
                  {/* Node Connector */}
                  <View style={styles.nodeContainer}>
                    {isFirst ? (
                      <View style={styles.primaryNode} />
                    ) : isLast ? (
                      <View style={styles.finalNodeRing}>
                        <View style={styles.finalNodeCore} />
                      </View>
                    ) : (
                      <View style={styles.secondaryNode} />
                    )}
                  </View>
                  
                  {/* Content */}
                  <View style={styles.contentColumn}>
                    <Text style={styles.stopLabelCaps}>{stopLabel}</Text>
                    <Text style={isPrimaryNode ? styles.stopAddressLg : styles.stopAddressMd}>
                      {stop.address.split(',')[0]}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* Payment Summary */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Payment Summary</Text>
          
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Trip Fare</Text>
            <Text style={styles.paymentValueMono}>{mockActiveTrip.fare}</Text>
          </View>
          <View style={styles.paymentRow}>
            <Text style={styles.paymentLabel}>Taxes & Fees</Text>
            <Text style={styles.paymentValueMono}>₹45.00</Text>
          </View>
          <View style={[styles.paymentRow, styles.paymentRowTotal]}>
            <Text style={styles.paymentTotalLabel}>Total Paid</Text>
            <Text style={styles.paymentTotalValue}>₹495.00</Text>
          </View>
          <View style={styles.paymentMethodRow}>
            <View style={styles.paymentMethodBadge}>
              <Feather name="credit-card" size={14} color={colors.onSurfaceVariant} />
              <Text style={styles.paymentMethodText}>Paid via UPI</Text>
            </View>
          </View>
        </View>

        {/* Driver Details */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Driver</Text>
          
          <View style={styles.driverRow}>
            <View style={styles.driverAvatar} />
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{mockActiveTrip.driverName}</Text>
              <View style={styles.driverMeta}>
                <Text style={styles.driverVehicle}>{mockActiveTrip.vehicleType}</Text>
                <View style={styles.dotSeparator} />
                <Feather name="star" size={12} color={colors.onSurfaceVariant} />
                <Text style={styles.driverVehicle}>{mockActiveTrip.driverRating}</Text>
              </View>
            </View>
            <Pressable
              style={styles.rateButton}
              onPress={() => (onRateTrip ? onRateTrip() : navigation?.navigate('DriverRatingScreen'))}
            >
              <Text style={styles.rateButtonText}>Rate Trip</Text>
            </Pressable>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionContainer}>
          <Pressable
            style={styles.primaryActionButton}
            onPress={() =>
              onDownloadInvoice ? onDownloadInvoice() : navigation?.navigate('DigitalReceiptScreen')
            }
          >
            <Feather name="download" size={20} color={colors.onPrimary} />
            <Text style={styles.primaryActionText}>Download Invoice</Text>
          </Pressable>
          <Pressable
            style={styles.secondaryActionButton}
            onPress={() => (onNeedHelp ? onNeedHelp() : navigation?.navigate('ActiveTripChatScreen'))}
          >
            <Feather name="help-circle" size={20} color={colors.onSurface} />
            <Text style={styles.secondaryActionText}>Need Help?</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surfaceContainerLow,
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
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    gap: spacing.xl,
  },

  // Status Section
  statusSection: {
    gap: spacing.md,
  },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surfaceContainerHigh,
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  statusTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  statusTime: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  metaLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  metaValue: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },

  // Common Section Card
  sectionCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D', // 30% opacity
    ...shadows.card,
  },
  sectionTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },

  // Timeline
  timelineContainer: {
    paddingLeft: spacing.xl,
    position: 'relative',
    gap: spacing.xl,
    paddingBottom: spacing.sm,
  },
  timelineLine: {
    position: 'absolute',
    left: 8,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: colors.surfaceVariant,
  },
  timelineRow: {
    position: 'relative',
  },
  nodeContainer: {
    position: 'absolute',
    left: -spacing.xl - 8,
    top: 4,
    width: 16,
    alignItems: 'center',
  },
  primaryNode: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.surfaceContainerLowest,
  },
  secondaryNode: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.surfaceContainerHighest,
    borderWidth: 4,
    borderColor: colors.surfaceContainerLowest,
  },
  finalNodeRing: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finalNodeCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  contentColumn: {},
  stopLabelCaps: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: 4,
  },
  stopAddressLg: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  stopAddressMd: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Payment
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  paymentLabel: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  paymentValueMono: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  paymentRowTotal: {
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    marginTop: spacing.xs,
    paddingTop: spacing.md,
  },
  paymentTotalLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  paymentTotalValue: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  paymentMethodRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  paymentMethodBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  paymentMethodText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Driver
  driverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
    gap: spacing.md,
  },
  driverAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceVariant,
  },
  driverInfo: {
    flex: 1,
  },
  driverName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  driverMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  driverVehicle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  dotSeparator: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: colors.outlineVariant,
  },
  rateButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.full,
  },
  rateButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Actions
  actionContainer: {
    gap: spacing.sm,
    marginBottom: spacing.xl * 2,
  },
  primaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 48,
    borderRadius: borderRadius.full,
  },
  primaryActionText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  secondaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceContainerHighest,
    height: 48,
    borderRadius: borderRadius.full,
  },
  secondaryActionText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default HistoricalTripDetailScreen;
