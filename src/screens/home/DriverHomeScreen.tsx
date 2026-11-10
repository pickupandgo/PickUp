import React, { useState, useCallback, useRef, useEffect, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { EarningsCard } from '../../components/molecules/EarningsCard';
import { WalletCard } from '../../components/molecules/WalletCard';
import Icon from '../../components/atoms/Icon';
import { GoLiveSheet } from '../../components/organisms/GoLiveSheet';
import { GoOfflineSheet } from '../../components/organisms/GoOfflineSheet';
import { incomingOffers } from '../../services/trip/incomingOfferRuntime';
import { useConnectionHealth } from '../../hooks/useConnectionHealth';
import { useDriverLocation } from '../../location';
import { TrackingService } from '../../services/tracking/TrackingService';
import type { HomeScreenProps } from '../../types/navigation';
import type { ActiveTrip, TripStop } from '../../types/trip';
import { useIncomingDriverDispatch as useDriverDispatch } from '../../hooks/useIncomingDriverDispatch';
import { useHomeDashboard } from '../../hooks/useHomeDashboard';
import { HomeBrandMark, HomeDeliveryArtwork } from '../../components/molecules/HomeArtwork';
import { CurrentVehicleCard } from '../../components/molecules/CurrentVehicleCard';
import { useTripResource } from '../../hooks/useActiveTrip';
import { TripLoadNotice } from '../../components/molecules/TripLoadNotice';
import { TripController } from '../../services/trip/TripController';
import { useCollectableTrips } from '../../hooks/useCollectableTrips';
import { CollectPaymentBanner } from '../../components/molecules/CollectPaymentBanner';
import type { DriverTripDto } from '../../services/payments/collectionsDto';
import { useI18n } from '../../i18n';
import { notificationInbox } from '../../services/notifications/NotificationInbox';
import { getCurrentDriverId } from '../../services/engine/dispatch';
import { EngineApiError } from '../../services/engine/engineClient';
import { describeTripError } from '../../services/trip/tripErrors';
import { LocationService } from '../../location/LocationService';
import { fareText } from '../../services/payments/money';

export type DriverMode = 'offline' | 'searching' | 'active_trip';

export interface DriverHomeScreenProps {
  readonly navigation: HomeScreenProps<'DriverHome'>['navigation'];
  readonly testID?: string;
}

interface TimelineRowProps {
  readonly stop: TripStop;
  readonly subLabel: string;
  readonly isLast: boolean;
}

const TimelineRow: React.FC<TimelineRowProps> = ({ stop, subLabel, isLast }) => {
  const isCompleted = stop.status === 'completed';
  const isCurrent = stop.status === 'current';

  return (
    <View style={[styles.tlRow, !isLast && styles.tlRowSpacing]}>
      <View style={styles.tlDotCol}>
        {isCurrent ? (
          <View style={styles.tlDotCurrentRing}>
            <View style={styles.tlDotCurrent} />
          </View>
        ) : isCompleted ? (
          <View style={styles.tlDotDone} />
        ) : (
          <View style={styles.tlDotPending} />
        )}
      </View>
      <View style={styles.tlTextCol}>
        <Text style={[styles.tlSubLabel, isCurrent && styles.tlSubLabelCurrent]}>{subLabel}</Text>
        <Text
          style={[
            styles.tlName,
            isCurrent && styles.tlNameCurrent,
            isCompleted && styles.tlNameDone,
          ]}
          numberOfLines={1}
        >
          {stop.label}
        </Text>
      </View>
    </View>
  );
};

const ActiveTripHero: React.FC<{ trip: ActiveTrip; onOpen: () => void }> = ({ trip, onOpen }) => {
  const { t } = useI18n();
  const stops = trip.stops;
  const currentStop = stops[trip.currentStopIndex] ?? stops.find((s) => s.status === 'current') ?? stops[0];
  const totalDrops = stops.filter((s) => s.type !== 'pickup').length;

  const distanceKm = currentStop?.distanceKm ?? trip.totalDistanceKm;
  const etaMinutes = currentStop?.etaMinutes;

  let dropCounter = 0;

  return (
    <View style={styles.heroCard}>
      <View style={styles.heroHeader}>
        <View style={styles.heroHeaderLeft}>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>{t('home.activeTrip')}</Text>
          </View>
          <Text style={styles.heroTitle} numberOfLines={1}>
            {currentStop?.label ?? 'Current Stop'}
          </Text>
          <Text style={styles.heroSubtitle}>
            {distanceKm != null ? `${distanceKm} km` : ''}
            {etaMinutes != null ? `${distanceKm != null ? ' · ' : ''}${etaMinutes} min away` : ''}
          </Text>
        </View>
        <View style={styles.earningBox}>
          <Text style={styles.earningAmount}>
            {fareText(trip.payablePaise)}
          </Text>
          <Text style={styles.earningLabel}>Customer fare</Text>
        </View>
      </View>

      <View style={styles.timeline}>
        <View style={styles.timelineLine} />
        {stops.map((stop, index) => {
          const isPickup = stop.type === 'pickup';
          if (!isPickup) dropCounter += 1;
          const subLabel = isPickup
            ? 'Pickup'
            : stop.status === 'current'
              ? `Drop ${dropCounter} of ${totalDrops}`
              : `Drop ${dropCounter}`;
          return (
            <TimelineRow
              key={stop.id}
              stop={stop}
              subLabel={subLabel}
              isLast={index === stops.length - 1}
            />
          );
        })}
      </View>

      <Pressable style={styles.openTripBtn} onPress={onOpen} accessibilityRole="button">
        <Text style={styles.openTripText}>{t('home.openTrip')}</Text>
        <Icon name="arrow_forward" size={16} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
};

// ─── Screen ────────────────────────────────────────────────────────

export const DriverHomeScreen: React.FC<DriverHomeScreenProps> = ({ navigation, testID }) => {
  const { requestPermission } = useDriverLocation();
  const { t } = useI18n();
  const recovery = useTripResource();
  const activeTrip = recovery.trip;
  const dashboard = useHomeDashboard(`${activeTrip?.id ?? ''}:${activeTrip?.status ?? ''}`);
  const collectable = useCollectableTrips();
  const tracking = TrackingService.getInstance();
  const online = useSyncExternalStore(tracking.subscribeOnline, tracking.getOnline);
  const connectionHealth = useConnectionHealth();
  const offerState = useSyncExternalStore(incomingOffers.subscribe, incomingOffers.getSnapshot);
  const [sheetMode, setSheetMode] = useState<'none' | 'go_live' | 'go_offline'>('none');
  const [availabilityConfirmed, setAvailabilityConfirmed] = useState(true);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const availabilityLock = useRef(false);
  const availabilityTarget = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);


  const handleToggleLive = useCallback((value: boolean) => {
    setSheetMode(value ? 'go_live' : 'go_offline');
  }, []);

  const updateAvailability = useCallback(async (value: boolean) => {
    if (availabilityLock.current) return;
    const uid = getCurrentDriverId();
    if (!uid) { setAvailabilityError('Please sign in again.'); return; }
    const current = () => mounted.current && getCurrentDriverId() === uid;
    availabilityLock.current = true; availabilityTarget.current = value;
    setAvailabilityBusy(true); setAvailabilityError(null);
    let attemptedServer = false, acknowledged = false;
    try {
      if (value) {
        await requestPermission();
        if (!current()) return;
        // requestPermission's React state can lag; read the native result directly.
        if (await LocationService.getPermissionStatus() !== 'granted')
          throw new Error('Precise location permission is required to go live.');
        if (!await LocationService.isProviderEnabled())
          throw new Error('Turn on location services before going live.');
        if (!current()) return;
      }
      if (!current()) return;
      attemptedServer = true;
      await TrackingService.getInstance().setOnline(value);
      acknowledged = true;
      if (!current()) return;
      setAvailabilityConfirmed(true);
    } catch (cause) {
      if (!current()) return;
      if (!current()) return;
      if (cause instanceof EngineApiError && cause.code === 'DRIVER_BUSY') {
        setAvailabilityConfirmed(true);
        TripController.getInstance().loadInitialTrip().catch(() => {});
      } else if (attemptedServer && !acknowledged && (!(cause instanceof EngineApiError) || cause.status === 0 || cause.status >= 500)) {
        setAvailabilityConfirmed(false); // An unanswered write is neither confirmed Online nor Offline.
      }
      setAvailabilityError(cause instanceof EngineApiError ? describeTripError(cause, t) :
        cause instanceof Error ? cause.message : 'Availability could not be confirmed. Please retry.');
    } finally {
      availabilityLock.current = false;
      if (current()) setAvailabilityBusy(false);
    }
  }, [requestPermission, t]);

  const confirmToggleLive = useCallback((value: boolean) => {
    setSheetMode('none'); void updateAvailability(value);
  }, [updateAvailability]);

  const handleNotifications = useCallback(() => {
    navigation.navigate('Notifications');
  }, [navigation]);

  const handleRecharge = useCallback(() => {
    // initial: false keeps the wallet screen underneath, so back and "Back to wallet" land there.
    navigation.getParent()?.navigate('WalletTab', { screen: 'Recharge', initial: false });
  }, [navigation]);

  const handleDetails = useCallback(() => {
    navigation.getParent()?.navigate('EarningsTab', { screen: 'EarningsHistory' });
  }, [navigation]);

  const handleCollect = useCallback(
    (trip: DriverTripDto) => navigation.navigate('CollectPayment', { tripId: trip.tripId }),
    [navigation],
  );

  const handleOpenTrip = useCallback(() => {
    if (activeTrip) {
      navigation.navigate('ActiveTrip', { tripId: activeTrip.id });
    }
  }, [navigation, activeTrip]);

  const isLive = online;
  // Recovering a trip does not require opting in to new offers / Go Live.
  const mode: DriverMode = activeTrip ? 'active_trip' : isLive && availabilityConfirmed && recovery.status === 'ready' ? 'searching' : 'offline';

  // Advertise availability + poll for offers only while live and not already on a trip.
  useDriverDispatch({ enabled: mode === 'searching' });
  const dispatchError = offerState.error;
  const resumeDispatch = () => { void incomingOffers.refresh(); };

  const statusLabel = availabilityBusy ? 'Updating...' : !activeTrip && !availabilityConfirmed ? 'Unconfirmed' :
    mode === 'active_trip' ? 'On a trip' : mode === 'searching' ? "You're online" : "You're offline";
  const canToggle = mode !== 'active_trip' && recovery.status === 'ready' && !availabilityBusy;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <HomeBrandMark />
          <View>
            <Text style={styles.headerTitle}>Multiple Ride</Text>
            <Text style={styles.headerSubtitle}>Partner</Text>
          </View>
        </View>
        <Pressable onPress={handleNotifications} style={styles.headerBell} accessibilityRole="button" accessibilityLabel="Notifications">
          <Icon name="notifications_none" size={23} color={colors.primary} />
          <UnreadNotificationDot />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={dashboard.vehicle.loading || dashboard.wallet.loading || dashboard.today.loading}
          onRefresh={() => { dashboard.refresh().catch(() => undefined); }} />}>
        <View style={styles.content}>
          {online && connectionHealth !== 'CONNECTED' ? <Text style={styles.heroSubtitle} accessibilityLiveRegion="polite">{connectionHealth === 'STALE' ? 'Location connection stale' : connectionHealth === 'RECONNECTING' ? 'Reconnecting' : 'Waiting for location connection'}</Text> : null}
          {/* Payment the driver can collect right now (payments backend) */}
          <CollectPaymentBanner trips={collectable} onPress={handleCollect} />

          {availabilityError || dispatchError ? (
            <Pressable accessibilityRole="button" disabled={availabilityBusy} onPress={() => {
              if (availabilityError) void updateAvailability(availabilityTarget.current);
              else resumeDispatch();
            }}>
              <Text style={{ ...typography.bodyMd, color: colors.error }} accessibilityRole="alert">
                {availabilityError ?? dispatchError} Tap to retry.
              </Text>
            </Pressable>
          ) : null}

          {activeTrip && recovery.status === 'error' ? (
            <Pressable accessibilityRole="button" onPress={() => {
              TripController.getInstance().loadInitialTrip().catch(() => {});
            }}>
              <Text style={{ ...typography.bodyMd, color: colors.error }} accessibilityRole="alert">
                Could not refresh trip status. Tap to retry.
              </Text>
            </Pressable>
          ) : null}

          <View>
            <View style={styles.availabilityRow}>
              <View style={styles.availabilityStatus}>
                <View style={[styles.statusDot, mode !== 'offline' && styles.statusDotOnline]} />
                <Text style={styles.statusLabel} accessibilityLiveRegion="polite">{statusLabel}</Text>
              </View>
              <View style={styles.availabilityDivider} />
              <Pressable testID="home-availability-toggle" accessibilityRole="button"
                accessibilityLabel={isLive ? 'Go offline' : 'Go online'}
                accessibilityState={{ disabled: !canToggle, busy: availabilityBusy }}
                onPress={canToggle ? () => handleToggleLive(!isLive) : undefined}
                disabled={!canToggle}
                style={({ pressed }) => [styles.onlineButton, !canToggle && styles.buttonDisabled, pressed && styles.buttonPressed]}>
                <Icon name="power_settings_new" size={17} color={colors.onPrimary} />
                <Text style={styles.onlineButtonText}>{availabilityBusy ? 'Updating...' : mode === 'active_trip' ? 'On trip' : isLive ? 'Go offline' : 'Go online'}</Text>
              </Pressable>
            </View>
            <Text style={styles.availabilityCaption}>
              {mode === 'active_trip' ? 'Your active delivery is ready to resume.' : mode === 'searching' ? t('home.availableNearby') : 'Go online to receive trip requests.'}
            </Text>
          </View>

          {mode === 'active_trip' && activeTrip ? (
            <ActiveTripHero trip={activeTrip} onOpen={handleOpenTrip} />
          ) : recovery.status !== 'ready' ? <TripLoadNotice /> : null}
          {!activeTrip && <HomeDeliveryArtwork />}

          {/* Vehicle */}
          <CurrentVehicleCard compact resource={dashboard.vehicle}
            onRetry={() => { dashboard.refresh().catch(() => undefined); }}
            onManage={() => navigation.getParent()?.navigate('AccountTab', { screen: 'VehicleStatus' })} />

          {/* Earnings + Wallet */}
          <View style={styles.dashboardRow}>
            <EarningsCard compact
              label="Today's earnings"
              amount={dashboard.today.data ? dashboard.today.data.netAmountPaise / 100 : null}
              currency="₹"
              tripCount={dashboard.today.data?.completedTripCount}
              loading={dashboard.today.loading}
              error={dashboard.today.error}
              onDetailsPress={handleDetails}
            />
            <WalletCard compact
              label="Wallet balance"
              rechargeLabel="Recharge +"
              balance={dashboard.wallet.data?.balance ?? null}
              currency={dashboard.wallet.data?.currency ?? '₹'}
              minimumBalance={dashboard.wallet.data?.minimumBalance ?? null}
              loading={dashboard.wallet.loading}
              error={dashboard.wallet.error}
              onRechargePress={handleRecharge}
            />
          </View>

          <Pressable onPress={() => navigation.navigate('Support')} accessibilityRole="button"
            accessibilityLabel="Help & support" style={({ pressed }) => [styles.supportRow, pressed && styles.buttonPressed]}>
            <Icon name="headset_mic" size={20} color={colors.onSurfaceMuted} />
            <Text style={styles.supportLabel}>Help & support</Text>
            <Icon name="chevron_right" size={20} color={colors.onSurfaceMuted} />
          </Pressable>
        </View>
      </ScrollView>

      {sheetMode !== 'none' && (
        <Modal transparent visible animationType="slide" presentationStyle="overFullScreen"
          statusBarTranslucent navigationBarTranslucent onRequestClose={() => setSheetMode('none')}>
          <View style={styles.modalContent}>
          <Pressable style={styles.backdrop} onPress={() => setSheetMode('none')}
            accessibilityRole="button" accessibilityLabel="Dismiss availability confirmation" />
            {sheetMode === 'go_live' && (
              <GoLiveSheet
                onContinue={() => confirmToggleLive(true)}
                onCancel={() => setSheetMode('none')}
              />
            )}
            {sheetMode === 'go_offline' && (
              <GoOfflineSheet
                onGoOffline={() => confirmToggleLive(false)}
                onStayLive={() => setSheetMode('none')}
              />
            )}
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, minHeight: 60, backgroundColor: colors.surfaceContainerLowest },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 16, lineHeight: 20, fontWeight: '700', color: colors.primary },
  headerSubtitle: { fontSize: 11, lineHeight: 15, color: colors.homeMuted },
  headerBell: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  redDot: { position: 'absolute', top: 9, right: 10, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.homeGreen, borderWidth: 1, borderColor: colors.surfaceContainerLowest },
  scrollContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24 },
  content: { gap: 16 },
  availabilityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingRight: 6, minHeight: 50, borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 11 },
  availabilityStatus: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.homeOffline },
  statusDotOnline: { backgroundColor: colors.homeGreen },
  statusLabel: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.primary },
  availabilityDivider: { width: 1, height: 22, backgroundColor: colors.homeBorder },
  onlineButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.homeGreen, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '48%' },
  onlineButtonText: { fontSize: 12, lineHeight: 17, fontWeight: '500', color: colors.onPrimary, flexShrink: 1 },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.75 },
  availabilityCaption: { fontSize: 11, lineHeight: 16, color: colors.homeMuted, marginTop: 5 },
  dashboardRow: { flexDirection: 'row', alignItems: 'stretch', gap: 10 },
  supportRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10 },
  supportLabel: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500', color: colors.primary },
  // Active trip hero
  heroCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    ...shadows.md,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  heroHeaderLeft: {
    flex: 1,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(3,7,29,0.05)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(3,7,29,0.10)',
  },
  heroBadgeText: {
    ...typography.labelCaps,
    fontSize: 10,
    color: colors.primary,
  },
  heroTitle: {
    ...typography.displaySm,
    color: colors.primary,
  },
  heroSubtitle: {
    ...typography.bodyLg,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  earningBox: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.gutter,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  earningAmount: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  earningLabel: {
    ...typography.labelCaps,
    fontSize: 10,
    color: colors.onSurfaceVariant,
  },
  // Timeline
  timeline: {
    position: 'relative',
    paddingLeft: spacing.xs,
    marginBottom: spacing.lg,
  },
  timelineLine: {
    position: 'absolute',
    left: 13,
    top: 6,
    bottom: 6,
    width: 2,
    backgroundColor: colors.surfaceVariant,
  },
  tlRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.gutter,
    position: 'relative',
    zIndex: 1,
  },
  tlRowSpacing: {
    marginBottom: spacing.gutter,
  },
  tlDotCol: {
    width: 18,
    alignItems: 'center',
    paddingTop: 2,
  },
  tlDotDone: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.surfaceContainerLowest,
  },
  tlDotCurrentRing: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(3,7,29,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlDotCurrent: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },
  tlDotPending: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.outline,
    backgroundColor: colors.surfaceContainerLowest,
  },
  tlTextCol: {
    flex: 1,
  },
  tlSubLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  tlSubLabelCurrent: {
    color: colors.primary,
    fontWeight: '600',
  },
  tlName: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  tlNameCurrent: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  tlNameDone: {
    textDecorationLine: 'line-through',
    opacity: 0.6,
  },
  openTripBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.sm,
  },
  openTripText: {
    ...typography.labelSm,
    color: colors.onPrimary,
    fontWeight: '600',
    letterSpacing: 1,
  },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.primary, opacity: 0.4 },
  modalContent: { flex: 1, justifyContent: 'flex-end' },
});

function UnreadNotificationDot() {
  const { unreadCount,items } = useSyncExternalStore(notificationInbox.subscribe, notificationInbox.getSnapshot);
  const hasUnread=unreadCount!==null?unreadCount>0:items.some(item=>item.readAt===null);
  return hasUnread ? <View style={styles.redDot} accessibilityLabel={unreadCount===null?'Unread notifications':`${unreadCount} unread notifications`} /> : null;
}

export default DriverHomeScreen;
