import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { EarningsCard } from '../../components/molecules/EarningsCard';
import { WalletCard } from '../../components/molecules/WalletCard';
import Icon from '../../components/atoms/Icon';
import { GoLiveSheet } from '../../components/organisms/GoLiveSheet';
import { GoOfflineSheet } from '../../components/organisms/GoOfflineSheet';
import { useFocusEffect } from '@react-navigation/native';
import { useDriverLocation, LocationService } from '../../location';
import type { HomeScreenProps } from '../../types/navigation';
import type { ActiveTrip, TripStop } from '../../types/trip';
import { useDriverDispatch } from '../../hooks/useDriverDispatch';
import { useWallet } from '../../hooks/useWallet';
import { useEarnings } from '../../hooks/useEarnings';
import { useActiveTrip } from '../../hooks/useActiveTrip';
import { useI18n } from '../../i18n';

export type DriverMode = 'offline' | 'searching' | 'active_trip';

export interface DriverHomeScreenProps {
  readonly navigation: HomeScreenProps<'DriverHome'>['navigation'];
  readonly testID?: string;
}

// ─── Animated helpers ──────────────────────────────────────────────

/** Green "live" dot with an expanding pulse ring (matches the Stitch pulse-dot). */
const LiveDot: React.FC = () => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.5] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  return (
    <View style={styles.liveDotWrap}>
      <Animated.View style={[styles.liveDotRing, { transform: [{ scale }], opacity }]} />
      <View style={styles.liveDotCore} />
    </View>
  );
};

/** Explore icon inside a softly "pinging" circle for the searching state. */
const SearchingPulse: React.FC = () => {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View style={styles.searchPulseWrap}>
      <Animated.View style={[styles.searchPulseRing, { transform: [{ scale }], opacity }]} />
      <View style={styles.searchPulseInner}>
        <Icon name="explore" size={26} color={colors.primary} />
      </View>
    </View>
  );
};

// ─── Active trip timeline ──────────────────────────────────────────

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
            {trip.currency}
            {trip.estimatedEarning}
          </Text>
          <Text style={styles.earningLabel}>{t('home.estEarning')}</Text>
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
  const { startTracking, stopTracking, requestPermission, currentLocation } = useDriverLocation();
  const { t } = useI18n();
  const { balance } = useWallet();
  const { summary } = useEarnings();
  const activeTrip = useActiveTrip();
  const [driverMode, setDriverMode] = useState<Exclude<DriverMode, 'active_trip'>>('offline');
  const [sheetMode, setSheetMode] = useState<'none' | 'go_live' | 'go_offline'>('none');

  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    requestPermission().catch(console.error);
  }, [requestPermission]);

  const handleToggleLive = useCallback((value: boolean) => {
    setSheetMode(value ? 'go_live' : 'go_offline');
  }, []);

  const confirmToggleLive = useCallback(
    (value: boolean) => {
      setSheetMode('none');
      Animated.timing(fadeAnim, {
        toValue: 0.5,
        duration: 200,
        useNativeDriver: true,
      }).start(async () => {
        try {
          if (value) {
            await requestPermission();
            await LocationService.startForegroundService();
            await startTracking();
          } else {
            await stopTracking();
            await LocationService.stopForegroundService();
          }
          setDriverMode(value ? 'searching' : 'offline');
        } catch (err) {
          console.error('Failed to toggle tracking:', err);
        } finally {
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: true,
          }).start();
        }
      });
    },
    [fadeAnim, startTracking, stopTracking, requestPermission],
  );

  const handleNotifications = useCallback(() => {
    navigation.navigate('NotificationCenter');
  }, [navigation]);

  const handleRecharge = useCallback(() => {
    navigation.getParent()?.navigate('WalletTab', { screen: 'Recharge' });
  }, [navigation]);

  const handleDetails = useCallback(() => {
    navigation.getParent()?.navigate('EarningsTab', { screen: 'EarningsHome' });
  }, [navigation]);

  const handleOpenTrip = useCallback(() => {
    if (activeTrip) {
      navigation.navigate('ActiveTrip', { tripId: activeTrip.id });
    }
  }, [navigation, activeTrip]);

  const isLive = driverMode === 'searching';
  // Effective view: offline > active trip (only while live) > searching.
  const mode: DriverMode = !isLive ? 'offline' : activeTrip ? 'active_trip' : 'searching';

  // Advertise availability + poll for offers only while live and not already on a trip.
  const { resume: resumeDispatch } = useDriverDispatch({
    enabled: mode === 'searching',
    getLocation: () =>
      currentLocation
        ? { latitude: currentLocation.latitude, longitude: currentLocation.longitude }
        : null,
    onOffer: (offer, driverId) => {
      navigation.navigate('TripOffer', { offer, driverId });
    },
  });

  useFocusEffect(
    useCallback(() => {
      resumeDispatch();
    }, [resumeDispatch]),
  );

  const pillLabel =
    mode === 'active_trip' ? t('home.online') : mode === 'searching' ? t('home.live') : t('home.offline');
  const canToggle = mode !== 'active_trip';

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerAvatar}>
            <Icon name="person" size={22} color={colors.onSurfaceVariant} />
          </View>
          <Text style={styles.headerTitle}>{t('home.driverHub')}</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={canToggle ? () => handleToggleLive(!isLive) : undefined}
            disabled={!canToggle}
            style={[
              styles.pill,
              mode === 'offline' && styles.pillOffline,
              mode !== 'offline' && styles.pillOnlineOuter,
            ]}
          >
            {mode === 'offline' ? (
              <View style={styles.pillInnerOffline}>
                <Text style={styles.pillTextOffline}>OFFLINE</Text>
                <View style={styles.dotStatic} />
              </View>
            ) : mode === 'active_trip' ? (
              <View style={styles.pillInnerOnline}>
                <LiveDot />
                <Text style={styles.pillTextOnline}>{pillLabel}</Text>
              </View>
            ) : (
              <View style={styles.pillInnerOnline}>
                <Text style={styles.pillTextOnline}>{pillLabel}</Text>
                <LiveDot />
              </View>
            )}
          </Pressable>
          <Pressable onPress={handleNotifications} style={styles.headerBell}>
            <Icon name="notifications" size={24} color={colors.onSurfaceVariant} />
            <View style={styles.redDot} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, gap: spacing.lg }}>
          {/* State-specific hero */}
          {mode === 'active_trip' && activeTrip ? (
            <ActiveTripHero trip={activeTrip} onOpen={handleOpenTrip} />
          ) : mode === 'searching' ? (
            <>
              <View style={styles.availabilityBanner}>
                <Icon name="radar" size={16} color={colors.primary} />
                <Text style={styles.bannerText}>{t('home.availableNearby')}</Text>
              </View>
              <View style={styles.searchingCard}>
                <SearchingPulse />
                <View style={styles.searchingTextWrap}>
                  <Text style={styles.searchingTitle}>{t('home.findingTitle')}</Text>
                  <Text style={styles.searchingSubtitle}>{t('home.findingSubtitle')}</Text>
                </View>
              </View>
            </>
          ) : (
            <View style={styles.offlineCard}>
              <Icon name="cloud_off" size={40} color={colors.onSurfaceVariant} style={styles.offlineIcon} />
              <View style={styles.searchingTextWrap}>
                <Text style={styles.offlineTitle}>{t('home.offlineTitle')}</Text>
                <Text style={styles.searchingSubtitle}>{t('home.offlineSubtitle')}</Text>
              </View>
            </View>
          )}

          {/* Vehicle */}
          <View style={styles.vehicleCard}>
            <View style={styles.vehicleIconContainer}>
              <Icon name="local_shipping" size={20} color={colors.onSurfaceVariant} />
            </View>
            <View style={styles.vehicleDetails}>
              <Text style={styles.vehicleLabel}>{t('home.currentVehicle')}</Text>
              <Text style={styles.vehicleName}>Tata Ace | RJ 19 XX 1234</Text>
            </View>
            <View style={styles.approvedPill}>
              <Icon name="check_circle" size={12} color={colors.primary} />
              <Text style={styles.approvedText}>{t('home.approved')}</Text>
            </View>
          </View>

          {/* Earnings + Wallet */}
          <View style={styles.dashboardRow}>
            <EarningsCard
              label={t('home.today')}
              amount={summary?.netEarnings || 0}
              currency={summary?.currency || '₹'}
              tripCount={summary?.totalTrips || 0}
              onDetailsPress={handleDetails}
            />
            <WalletCard
              label={t('home.walletLabel')}
              balance={balance?.balance || 0}
              currency={balance?.currency || '₹'}
              minimumBalance={balance?.minimumBalance || 0}
              onRechargePress={handleRecharge}
            />
          </View>

          {/* Delivery protocol — hidden while offline (matches Stitch offline state) */}
          {mode !== 'offline' && (
            <View style={styles.protocolCard}>
              <View style={styles.protocolAccent} />
              <View style={styles.protocolContent}>
                <View style={styles.protocolHeader}>
                  <Icon name="photo_camera" size={18} color={colors.primary} />
                  <Text style={styles.protocolTitle}>{t('home.deliveryProtocol')}</Text>
                </View>
                <Text style={styles.protocolDescription}>{t('home.deliveryProtocolDesc')}</Text>
              </View>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {sheetMode !== 'none' && (
        <View style={StyleSheet.absoluteFill}>
          <Pressable style={styles.backdrop} onPress={() => setSheetMode('none')} />
          <View style={styles.sheetWrapper}>
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
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    height: 64,
    backgroundColor: colors.surfaceContainerLowest,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  headerTitle: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  // Availability pill
  pill: {
    borderRadius: borderRadius.full,
    padding: 4,
    borderWidth: 1,
  },
  pillOffline: {
    backgroundColor: colors.surfaceContainer,
    borderColor: colors.outlineVariant,
    paddingRight: spacing.sm,
  },
  pillOnlineOuter: {
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderColor: 'rgba(34,197,94,0.25)',
    paddingRight: spacing.sm,
  },
  pillInnerOffline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: borderRadius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
  },
  pillInnerOnline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.full,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    ...shadows.sm,
  },
  pillTextOffline: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  pillTextOnline: {
    ...typography.labelCaps,
    color: colors.primary,
  },
  dotStatic: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.outlineVariant,
  },
  liveDotWrap: {
    width: 8,
    height: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDotRing: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  liveDotCore: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#22c55e',
  },
  headerBell: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redDot: {
    position: 'absolute',
    top: 4,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
    borderWidth: 1,
    borderColor: colors.surfaceContainerLowest,
  },
  scrollContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.lg,
  },
  // Offline card
  offlineCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  offlineIcon: {
    opacity: 0.4,
  },
  offlineTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
    textAlign: 'center',
  },
  // Searching state
  availabilityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(3,7,29,0.05)',
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.lg,
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: 'rgba(3,7,29,0.10)',
  },
  bannerText: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '500',
  },
  searchingCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.xl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.gutter,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    ...shadows.md,
  },
  searchingTextWrap: {
    alignItems: 'center',
    gap: 2,
  },
  searchingTitle: {
    ...typography.headlineSm,
    color: colors.primary,
    textAlign: 'center',
  },
  searchingSubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  searchPulseWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPulseRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(3,7,29,0.08)',
  },
  searchPulseInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(3,7,29,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // Vehicle
  vehicleCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.xl,
    padding: spacing.containerPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    ...shadows.sm,
  },
  vehicleIconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleDetails: {
    flex: 1,
    gap: 2,
  },
  vehicleLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
  },
  vehicleName: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onSurface,
  },
  approvedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(3,7,29,0.05)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: 'rgba(3,7,29,0.10)',
  },
  approvedText: {
    ...typography.labelCaps,
    fontSize: 10,
    color: colors.primary,
  },
  dashboardRow: {
    flexDirection: 'row',
    gap: spacing.containerPadding,
  },
  // Protocol
  protocolCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    flexDirection: 'row',
    overflow: 'hidden',
    ...shadows.sm,
  },
  protocolAccent: {
    width: 4,
    backgroundColor: colors.primary,
  },
  protocolContent: {
    flex: 1,
    padding: spacing.containerPadding,
    gap: spacing.xs,
  },
  protocolHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  protocolTitle: {
    ...typography.labelSm,
    fontWeight: '600',
    color: colors.onSurface,
  },
  protocolDescription: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetWrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
});

export default DriverHomeScreen;
