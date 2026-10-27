import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Alert, Clipboard, Share } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { mockHistoricalTrip } from '../../data/mockData';
import { useI18n } from '../../i18n';
import { AppHeader } from '../../components/molecules/AppHeader';
import { TripService } from '../../services/trip/TripService';
import type { HistoricalTrip, TripStop } from '../../types/trip';
import type { TripsScreenProps } from '../../types/navigation';

export interface HistoricalTripDetailScreenProps {
  readonly navigation: TripsScreenProps<'HistoricalTripDetail'>['navigation'];
  readonly route: TripsScreenProps<'HistoricalTripDetail'>['route'];
  readonly testID?: string;
}

const formatVehicleName = (rawType?: string): string => {
  if (!rawType) return 'Mini Truck';
  const clean = rawType.trim().toUpperCase();
  const map: Record<string, string> = {
    TWO_WHEELER: 'Two Wheeler (Bike)',
    THREE_WHEELER: '3 Wheeler (Tempo)',
    TATA_ACE: 'Tata Ace (Chhota Hathi)',
    PICKUP_8FT: '8ft Pickup',
    PICKUP: 'Pickup Truck',
    MINI_TRUCK: 'Mini Truck',
    TRUCK: 'Commercial Truck',
  };
  return map[clean] || rawType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

export const HistoricalTripDetailScreen: React.FC<HistoricalTripDetailScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const routeTrip = route.params.trip;
  const [trip, setTrip] = useState<HistoricalTrip>(routeTrip || mockHistoricalTrip);

  useEffect(() => {
    let active = true;
    TripService.getInstance()
      .getHistory()
      .then((trips) => {
        if (!active) return;
        const found = trips.find((t) => t.id === route.params.tripId);
        if (found) {
          setTrip(found);
        }
      })
      .catch((err) => {
        console.warn('Failed to load trip detail:', err);
      });
    return () => {
      active = false;
    };
  }, [route.params.tripId]);

  const earnings = trip.earnings;
  const isCancelled = trip.status === 'cancelled';
  const pickup = trip.stops[0];
  const dropStops = trip.stops.slice(1);
  const vehicleName = formatVehicleName(trip.vehicleType);

  const handleCopyId = useCallback(() => {
    try {
      Clipboard.setString(trip.id);
      Alert.alert('Copied to Clipboard', `Trip ID #${trip.id} copied.`);
    } catch {
      // ignore
    }
  }, [trip.id]);

  const handleSupportPress = useCallback(() => {
    Alert.alert(
      'MultipleRide Driver Support',
      `Need help with Trip #${trip.id.slice(0, 8)}?\n\nOur 24/7 dedicated support team is available to assist you.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Call Support (+91 1800-PICKUP)', onPress: () => {} },
      ],
    );
  }, [trip.id]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top']}>
      <AppHeader
        title={`Trip Details #${trip.id.slice(0, 8)}`}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* 1. Hero Status Card */}
        <View style={[styles.card, isCancelled ? styles.heroCancelled : styles.heroCompleted]}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconCircle}>
              <Icon
                name={isCancelled ? 'cancel' : 'check_circle'}
                size={28}
                color={isCancelled ? '#DC2626' : '#16A34A'}
              />
            </View>
            <View style={styles.heroTextCol}>
              <View style={styles.statusPillRow}>
                <View style={[styles.statusPill, isCancelled ? styles.pillCancelled : styles.pillCompleted]}>
                  <Text style={[styles.statusPillText, isCancelled ? styles.pillTextCancelled : styles.pillTextCompleted]}>
                    {isCancelled ? 'TRIP CANCELLED' : 'TRIP COMPLETED'}
                  </Text>
                </View>
                <Pressable onPress={handleCopyId} hitSlop={8} style={styles.copyIdBtn}>
                  <Text style={styles.shortIdText}>#{trip.id.slice(0, 8)}</Text>
                  <Icon name="content_copy" size={12} color="#64748B" />
                </Pressable>
              </View>
              <Text style={styles.heroDateTimeText}>
                {trip.date} • {trip.time}
              </Text>
            </View>
          </View>

          {/* Cancellation or Completion explanation banner */}
          {isCancelled ? (
            <View style={styles.alertBannerCancelled}>
              <Icon name="info" size={16} color="#DC2626" />
              <View style={styles.alertBannerTextCol}>
                <Text style={styles.alertBannerTitle}>
                  Reason: {trip.cancellationReason || 'Cancelled by customer'}
                </Text>
                <Text style={styles.alertBannerSubtitle}>
                  This ride was cancelled before delivery. No penalties or fees were charged to your account.
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.alertBannerCompleted}>
              <Icon name="verified" size={16} color="#16A34A" />
              <View style={styles.alertBannerTextCol}>
                <Text style={styles.alertBannerTitleCompleted}>
                  Successfully Delivered & Verified
                </Text>
                <Text style={styles.alertBannerSubtitleCompleted}>
                  All stops completed. Net earnings have been credited to your driver wallet.
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* 2. Key Metrics Row */}
        <View style={styles.metricsRow}>
          <View style={styles.metricItem}>
            <View style={styles.metricIconBox}>
              <Icon name="payments" size={18} color="#2563EB" />
            </View>
            <Text style={styles.metricValue}>
              {earnings.currency}{earnings.netEarning.toFixed(2)}
            </Text>
            <Text style={styles.metricLabel}>Net Earning</Text>
          </View>

          <View style={styles.metricItem}>
            <View style={styles.metricIconBox}>
              <Icon name="pin_drop" size={18} color="#16A34A" />
            </View>
            <Text style={styles.metricValue}>{trip.stops.length}</Text>
            <Text style={styles.metricLabel}>Total Stops</Text>
          </View>

          <View style={styles.metricItem}>
            <View style={styles.metricIconBox}>
              <Icon name="straighten" size={18} color="#D97706" />
            </View>
            <Text style={styles.metricValue}>
              {trip.totalDistanceKm ? `${trip.totalDistanceKm} km` : '6.4 km'}
            </Text>
            <Text style={styles.metricLabel}>Distance</Text>
          </View>
        </View>

        {/* 3. Full Route Timeline Card */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="route" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>JOURNEY ROUTE & STOPS</Text>
          </View>

          {/* Pickup Stop */}
          <View style={styles.timelineRow}>
            <View style={styles.timelineColumn}>
              <View style={styles.timelinePickupCircle}>
                <View style={styles.innerPickupDot} />
              </View>
              <View style={styles.timelineDashedLine} />
            </View>
            <View style={styles.stopContent}>
              <View style={styles.stopHeader}>
                <Text style={styles.pickupLabel}>PICKUP LOCATION</Text>
                <View style={styles.stopBadgeCompleted}>
                  <Text style={styles.stopBadgeTextCompleted}>Completed</Text>
                </View>
              </View>
              <Text style={styles.stopAddress}>{pickup?.address || 'Pickup Address'}</Text>
              {pickup?.notes ? (
                <Text style={styles.stopNotes}>Note: {pickup.notes}</Text>
              ) : null}
            </View>
          </View>

          {/* Drop-off Stop(s) */}
          {dropStops.length > 0 ? (
            dropStops.map((stop: TripStop, index: number) => {
              const isLast = index === dropStops.length - 1;
              return (
                <View key={stop.id} style={styles.timelineRow}>
                  <View style={styles.timelineColumn}>
                    <View style={[styles.timelineDropCircle, isCancelled && styles.timelineDropCancelled]}>
                      <View style={[styles.innerDropSquare, isCancelled && styles.innerDropCancelled]} />
                    </View>
                    {!isLast && <View style={styles.timelineDashedLine} />}
                  </View>
                  <View style={styles.stopContent}>
                    <View style={styles.stopHeader}>
                      <Text style={[styles.dropLabel, isCancelled && styles.dropLabelCancelled]}>
                        {dropStops.length > 1 ? `DROP-OFF ${index + 1}${isLast ? ' (FINAL)' : ''}` : 'DROP-OFF LOCATION'}
                      </Text>
                      <View style={isCancelled ? styles.stopBadgeCancelled : styles.stopBadgeCompleted}>
                        <Text style={isCancelled ? styles.stopBadgeTextCancelled : styles.stopBadgeTextCompleted}>
                          {isCancelled ? 'Cancelled' : 'Delivered'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.stopAddress, isCancelled && styles.stopAddressCancelled]}>
                      {stop.address}
                    </Text>
                    {stop.notes ? (
                      <Text style={styles.stopNotes}>Note: {stop.notes}</Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.timelineRow}>
              <View style={styles.timelineColumn}>
                <View style={[styles.timelineDropCircle, isCancelled && styles.timelineDropCancelled]}>
                  <View style={[styles.innerDropSquare, isCancelled && styles.innerDropCancelled]} />
                </View>
              </View>
              <View style={styles.stopContent}>
                <Text style={[styles.dropLabel, isCancelled && styles.dropLabelCancelled]}>
                  DROP-OFF LOCATION
                </Text>
                <Text style={[styles.stopAddress, isCancelled && styles.stopAddressCancelled]}>
                  {isCancelled ? 'Trip cancelled before drop-off was reached' : 'Destination'}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* 4. Earnings & Financial Breakdown */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="receipt_long" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>FARE & EARNINGS BREAKDOWN</Text>
          </View>

          <View style={styles.finRow}>
            <Text style={styles.finLabel}>Total Gross Fare</Text>
            <Text style={styles.finValue}>
              {earnings.currency}{earnings.grossEarning.toFixed(2)}
            </Text>
          </View>

          <View style={styles.finRow}>
            <Text style={styles.finLabelDeduct}>
              Platform Commission ({earnings.platformCommissionPercent || 15}%)
            </Text>
            <Text style={styles.finValueDeduct}>
              -{earnings.currency}{earnings.platformCommission.toFixed(2)}
            </Text>
          </View>

          {earnings.otherDeductions > 0 && (
            <View style={styles.finRow}>
              <Text style={styles.finLabelDeduct}>Other Deductions / Taxes</Text>
              <Text style={styles.finValueDeduct}>
                -{earnings.currency}{earnings.otherDeductions.toFixed(2)}
              </Text>
            </View>
          )}

          <View style={styles.divider} />

          <View style={styles.netEarningRow}>
            <View>
              <Text style={styles.netEarningLabel}>Net Driver Earnings</Text>
              <Text style={styles.paymentMethodSub}>
                Payment Mode: {trip.paymentMethod || 'Wallet Transfer'}
              </Text>
            </View>
            <Text style={[styles.netEarningValue, isCancelled && styles.netEarningMuted]}>
              {earnings.currency}{earnings.netEarning.toFixed(2)}
            </Text>
          </View>

          {earnings.paidToWallet && !isCancelled && (
            <View style={styles.paidConfirmationBox}>
              <Icon name="check_circle" size={16} color="#15803D" />
              <Text style={styles.paidConfirmationText}>
                Amount successfully credited to Driver Wallet
              </Text>
            </View>
          )}
        </View>

        {/* 5. Vehicle & Load Specifications */}
        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="local_shipping" size={18} color={colors.primary} />
            <Text style={styles.sectionTitle}>VEHICLE & LOAD SPECIFICATIONS</Text>
          </View>

          <View style={styles.specGrid}>
            <View style={styles.specItem}>
              <Text style={styles.specLabel}>Vehicle Category</Text>
              <Text style={styles.specValue}>{vehicleName}</Text>
            </View>

            <View style={styles.specItem}>
              <Text style={styles.specLabel}>Vehicle / Trip Ref</Text>
              <Text style={styles.specValue}>{trip.vehicleRegistration || `#${trip.id.slice(0, 8)}`}</Text>
            </View>

            <View style={styles.specItem}>
              <Text style={styles.specLabel}>Goods / Cargo Type</Text>
              <Text style={styles.specValue}>{trip.goodsType || 'General Cargo'}</Text>
            </View>

            <View style={styles.specItem}>
              <Text style={styles.specLabel}>Package Weight</Text>
              <Text style={styles.specValue}>{trip.totalWeight || 'Standard Load'}</Text>
            </View>
          </View>
        </View>

        {/* 6. Help & Support Action */}
        <Pressable
          style={styles.supportButton}
          onPress={handleSupportPress}
          accessibilityRole="button"
          accessibilityLabel="Need help with this trip"
        >
          <Icon name="support_agent" size={20} color={colors.primary} />
          <Text style={styles.supportButtonText}>Need Help with this Trip?</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: spacing.containerPadding,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    ...shadows.sm,
  },
  heroCompleted: {
    borderColor: '#BBF7D0',
    backgroundColor: '#FFFFFF',
  },
  heroCancelled: {
    borderColor: '#FECACA',
    backgroundColor: '#FFFFFF',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTextCol: {
    flex: 1,
    gap: 4,
  },
  statusPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  pillCompleted: {
    backgroundColor: '#DCFCE7',
  },
  pillCancelled: {
    backgroundColor: '#FEE2E2',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pillTextCompleted: {
    color: '#15803D',
  },
  pillTextCancelled: {
    color: '#B91C1C',
  },
  copyIdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  shortIdText: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#475569',
    fontWeight: '600',
  },
  heroDateTimeText: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  alertBannerCancelled: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 10,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  alertBannerCompleted: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    borderRadius: 10,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  alertBannerTextCol: {
    flex: 1,
    gap: 2,
  },
  alertBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#991B1B',
  },
  alertBannerSubtitle: {
    fontSize: 11,
    color: '#7F1D1D',
    lineHeight: 16,
  },
  alertBannerTitleCompleted: {
    fontSize: 12,
    fontWeight: '700',
    color: '#166534',
  },
  alertBannerSubtitleCompleted: {
    fontSize: 11,
    color: '#14532D',
    lineHeight: 16,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricItem: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: spacing.sm,
    alignItems: 'center',
    ...shadows.sm,
  },
  metricIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
  },
  metricLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.6,
  },
  timelineRow: {
    flexDirection: 'row',
    minHeight: 56,
  },
  timelineColumn: {
    alignItems: 'center',
    width: 24,
    marginRight: spacing.xs,
  },
  timelinePickupCircle: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#DCFCE7',
    borderWidth: 2,
    borderColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerPickupDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  timelineDashedLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#CBD5E1',
    marginVertical: 3,
  },
  timelineDropCircle: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: '#EFF6FF',
    borderWidth: 2,
    borderColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineDropCancelled: {
    borderColor: '#94A3B8',
    backgroundColor: '#F1F5F9',
  },
  innerDropSquare: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: '#2563EB',
  },
  innerDropCancelled: {
    backgroundColor: '#94A3B8',
  },
  stopContent: {
    flex: 1,
    paddingBottom: spacing.sm,
  },
  stopHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  pickupLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#16A34A',
    letterSpacing: 0.5,
  },
  dropLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#2563EB',
    letterSpacing: 0.5,
  },
  dropLabelCancelled: {
    color: '#94A3B8',
  },
  stopBadgeCompleted: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  stopBadgeTextCompleted: {
    fontSize: 10,
    fontWeight: '700',
    color: '#15803D',
  },
  stopBadgeCancelled: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  stopBadgeTextCancelled: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B91C1C',
  },
  stopAddress: {
    fontSize: 13,
    color: '#1E293B',
    fontWeight: '500',
    lineHeight: 18,
  },
  stopAddressCancelled: {
    color: '#64748B',
  },
  stopNotes: {
    fontSize: 11,
    color: '#64748B',
    fontStyle: 'italic',
    marginTop: 2,
  },
  finRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  finLabel: {
    fontSize: 13,
    color: '#475569',
  },
  finValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  finLabelDeduct: {
    fontSize: 13,
    color: '#64748B',
  },
  finValueDeduct: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
  },
  divider: {
    height: 1,
    backgroundColor: '#E2E8F0',
    marginVertical: spacing.sm,
  },
  netEarningRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  netEarningLabel: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  paymentMethodSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  netEarningValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#16A34A',
  },
  netEarningMuted: {
    color: '#94A3B8',
  },
  paidConfirmationBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F0FDF4',
    padding: spacing.sm,
    borderRadius: 8,
    marginTop: spacing.sm,
  },
  paidConfirmationText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#15803D',
  },
  specGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  specItem: {
    width: '46%',
    gap: 2,
  },
  specLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  specValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  supportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingVertical: spacing.md,
    ...shadows.sm,
  },
  supportButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
});

export default HistoricalTripDetailScreen;
