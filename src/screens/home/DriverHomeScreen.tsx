import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { EarningsCard } from '../../components/molecules/EarningsCard';
import { WalletCard } from '../../components/molecules/WalletCard';
import Icon from '../../components/atoms/Icon';
import { GoLiveSheet } from '../../components/organisms/GoLiveSheet';
import { GoOfflineSheet } from '../../components/organisms/GoOfflineSheet';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useFocusEffect } from '@react-navigation/native';
import { useDriverLocation, LocationService } from '../../location';
import type { HomeScreenProps } from '../../types/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useDriverDispatch } from '../../hooks/useDriverDispatch';
import { useWallet } from '../../hooks/useWallet';
import { useEarnings } from '../../hooks/useEarnings';
import { DriverMap, MapOverlay } from '../../map';


export type DriverMode = 'offline' | 'searching' | 'active_trip';

export interface DriverHomeScreenProps {
  readonly navigation: HomeScreenProps<'DriverHome'>['navigation'];
  readonly testID?: string;
}

export const DriverHomeScreen: React.FC<DriverHomeScreenProps> = ({
  navigation,
  testID,
}) => {
  const { startTracking, stopTracking, requestPermission, currentLocation, error: locationError } = useDriverLocation();
  const { driver } = useAuth();
  const { balance } = useWallet();
  const { summary } = useEarnings();
  const [driverMode, setDriverMode] = useState<DriverMode>('offline');
  const [sheetMode, setSheetMode] = useState<'none' | 'go_live' | 'go_offline'>('none');

  const fadeAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Ask for location permissions on app launch/mount
    requestPermission().catch(console.error);
  }, [requestPermission]);

  const handleToggleLive = useCallback((value: boolean) => {
    setSheetMode(value ? 'go_live' : 'go_offline');
  }, []);

  const confirmToggleLive = useCallback((value: boolean) => {
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
  }, [fadeAnim, startTracking, stopTracking, requestPermission]);

  const handleNotifications = useCallback(() => {
    navigation.navigate('NotificationCenter');
  }, [navigation]);

  const handleRecharge = useCallback(() => {
    navigation.getParent()?.navigate('WalletTab', { screen: 'Recharge' });
  }, [navigation]);

  const handleDetails = useCallback(() => {
    navigation.getParent()?.navigate('EarningsTab', { screen: 'EarningsHome' });
  }, [navigation]);

  // Advertise availability + poll the engine for incoming ride requests while online.
  const { resume: resumeDispatch } = useDriverDispatch({
    enabled: driverMode === 'searching',
    getLocation: () =>
      currentLocation
        ? { latitude: currentLocation.latitude, longitude: currentLocation.longitude }
        : null,
    onOffer: (offer, driverId) => {
      navigation.navigate('TripOffer', { offer, driverId });
    },
  });

  // Resume polling when returning to Home after declining/expiring an offer.
  useFocusEffect(
    useCallback(() => {
      resumeDispatch();
    }, [resumeDispatch]),
  );

  const isLive = driverMode === 'searching';

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerAvatar}>
            <Icon name="person" style={styles.avatarIcon} />
          </View>
          <Text style={styles.headerTitle}>Driver Hub</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable onPress={() => handleToggleLive(!isLive)} style={[styles.livePill, isLive && styles.livePillActive]}>
            {isLive && <View style={[styles.liveDot, styles.liveDotActive]} />}
            <Text style={[styles.livePillText, isLive && styles.livePillTextActive]}>
              {isLive ? 'ONLINE' : 'OFFLINE'}
            </Text>
            {!isLive && <View style={styles.liveDot} />}
          </Pressable>
          <Pressable onPress={handleNotifications} style={styles.headerBell}>
            <Icon name="notifications" style={styles.bellIcon} />
            <View style={styles.redDot} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View style={{ opacity: fadeAnim, gap: spacing.containerPadding }}>
          {/* Embedded Map Card */}
          <View style={styles.mapCard}>
            <DriverMap
              currentLocation={currentLocation || undefined}
              showControls={false}
              followDriver={true}
            />
            
            <MapOverlay position="top" style={styles.mapOverlayTop}>
              {locationError && (
                <View style={styles.gpsWarning}>
                  <Icon name="gps_off" style={styles.gpsWarningIcon} />
                  <Text style={styles.gpsWarningText}>GPS Signal Weak</Text>
                </View>
              )}
              {isLive ? (
                <View style={styles.searchingContainer}>
                  <Text style={styles.searchingTitle}>Searching for Trips</Text>
                </View>
              ) : (
                <View style={styles.offlineContainer}>
                  <Text style={styles.offlineTitle}>You're Offline</Text>
                </View>
              )}
            </MapOverlay>
          </View>

          <View style={styles.vehicleCard}>
            <View style={styles.vehicleIconContainer}>
              <Icon name="local_shipping" style={styles.vehicleIcon} />
            </View>
            <View style={styles.vehicleDetails}>
              <Text style={styles.vehicleLabel}>CURRENT VEHICLE</Text>
              <Text style={styles.vehicleName}>Tata Ace | RJ 19 XX 1234</Text>
            </View>
            <View style={styles.approvedPill}>
              <Text style={styles.approvedText}>APPROVED</Text>
            </View>
          </View>

          <View style={styles.dashboardRow}>
            <EarningsCard
              label="TODAY"
              amount={summary?.netEarnings || 0}
              currency={summary?.currency || '₹'}
              tripCount={summary?.totalTrips || 0}
              onDetailsPress={handleDetails}
            />
            <WalletCard
              label="WALLET"
              balance={balance?.balance || 0}
              currency={balance?.currency || '₹'}
              minimumBalance={balance?.minimumBalance || 0}
              onRechargePress={handleRecharge}
            />
          </View>

          <View style={styles.protocolCard}>
            <View style={styles.protocolAccent} />
            <View style={styles.protocolContent}>
              <View style={styles.protocolHeader}>
                <Icon name="photo_camera" style={styles.protocolIcon} />
                <Text style={styles.protocolTitle}>Delivery Protocol</Text>
              </View>
              <Text style={styles.protocolDescription}>
                Delivery photo required at each drop location. Ensure clear visibility of package.
              </Text>
            </View>
          </View>
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
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
    backgroundColor: colors.surface,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarIcon: {
    fontSize: 24,
    color: colors.onSurfaceVariant,
  },
  headerTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.gutter,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    gap: 6,
  },
  livePillActive: {
    backgroundColor: colors.success,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.outline,
  },
  liveDotActive: {
    backgroundColor: colors.onPrimary,
  },
  livePillText: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  livePillTextActive: {
    color: colors.onPrimary,
  },
  headerBell: {
    width: 40,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  bellIcon: {
    fontSize: 24,
    color: colors.onSurfaceVariant,
  },
  redDot: {
    position: 'absolute',
    top: 8,
    right: 2,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.error,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.xs,
  },
  availabilityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainer,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.gutter,
    borderRadius: borderRadius.full,
    gap: spacing.xs,
    alignSelf: 'center',
  },
  bannerIcon: {
    fontSize: 16,
    color: colors.onSurface,
  },
  bannerText: {
    ...typography.labelSm,
    color: colors.onSurface,
  },
  tripSearchCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.containerPadding,
    ...shadows.sm,
  },
  tripSearchIconContainer: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripSearchIcon: {
    fontSize: 24,
    color: colors.primary,
  },
  tripSearchTextContainer: {
    flex: 1,
    gap: 4,
  },
  tripSearchTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  tripSearchSubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  mapCard: {
    height: 260,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: spacing.xs,
    backgroundColor: colors.surfaceContainerLow,
  },
  mapOverlayTop: { width: '100%', paddingHorizontal: spacing.gutter, paddingTop: spacing.xs, alignItems: 'flex-start' },
  gpsWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffcdd2',
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
    gap: spacing.xs,
    marginBottom: spacing.gutter,
  },
  gpsWarningIcon: { fontSize: 16, color: colors.error },
  gpsWarningText: { ...typography.labelSm, color: colors.error },
  metricsOverlay: {
    bottom: spacing.gutter,
    alignSelf: 'center',
    width: '90%',
  },
  vehicleCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
    ...shadows.sm,
  },
  vehicleIconContainer: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleIcon: {
    fontSize: 20,
    color: colors.primary,
  },
  vehicleDetails: {
    flex: 1,
    gap: 2,
  },
  vehicleLabel: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  vehicleName: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onSurface,
  },
  approvedPill: {
    backgroundColor: '#e6f4ea',
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
  },
  approvedText: {
    ...typography.labelCaps,
    fontSize: 10,
    color: '#137333',
  },
  dashboardRow: {
    flexDirection: 'row',
    gap: spacing.gutter,
  },
  protocolCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
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
  protocolIcon: {
    fontSize: 18,
    color: colors.primary,
  },
  protocolTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  protocolDescription: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    lineHeight: 20,
  },
  searchingContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: spacing.xs,
  },
  searchingTitle: {
    ...typography.labelSm,
    color: colors.surface,
  },
  offlineContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: spacing.xs,
  },
  offlineTitle: {
    ...typography.labelSm,
    color: colors.surface,
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


