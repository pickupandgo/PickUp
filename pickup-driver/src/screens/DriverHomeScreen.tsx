import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, shadows } from '../theme';
import MapCanvas, { type MapMarker } from '../components/map/MapCanvas';
import { useDriver } from '../state/DriverContext';
import RideRequestSheet from '../components/RideRequestSheet';
import { acceptRide, getTripForRide, rejectRide } from '../api/driver';
import { toApiError } from '../api/http';
import { env, hasApiConfig } from '../config/env';

/**
 * Driver home: go online, then wait for requests.
 *
 * Going online starts a GPS watcher and a 3s heartbeat (see DriverContext).
 * Both are required for the customer app to see this driver at all.
 */
const DriverHomeScreen: React.FC<{ readonly navigation?: any }> = ({ navigation }) => {
  const {
    driverId,
    setDriverId,
    isOnline,
    isBusy,
    goOnline,
    goOffline,
    location,
    error,
    pendingRequest,
    dismissRequest,
    activeTrip,
    setActiveTrip,
  } = useDriver();

  const [idDraft, setIdDraft] = useState(driverId);
  const [isAnswering, setIsAnswering] = useState(false);
  const [actionError, setActionError] = useState<string>();

  useEffect(() => setIdDraft(driverId), [driverId]);

  // An in-progress trip takes over the screen, including after a restart.
  useEffect(() => {
    if (activeTrip && activeTrip.status !== 'COMPLETED' && activeTrip.status !== 'CANCELLED') {
      navigation?.navigate('DriverTrip');
    }
  }, [activeTrip, navigation]);

  // Driver's own position is the OS "my location" dot from `showsUserLocation`.
  // A separate truck marker on top of it would just be visual noise.
  const markers = useMemo<readonly MapMarker[]>(() => {
    const built: MapMarker[] = [];
    if (pendingRequest) {
      built.push({
        id: 'req-pickup',
        kind: 'pickup',
        coordinate: pendingRequest.pickup,
        title: 'Pickup',
        description: pendingRequest.pickup.address,
      });
      built.push({
        id: 'req-drop',
        kind: 'drop',
        coordinate: pendingRequest.drop,
        title: 'Drop',
        description: pendingRequest.drop.address,
      });
    }
    return built;
  }, [location, pendingRequest]);

  const handleAccept = async () => {
    if (!pendingRequest) return;
    setIsAnswering(true);
    setActionError(undefined);
    try {
      await acceptRide(pendingRequest.rideId, driverId);
      const trip = await getTripForRide(pendingRequest.rideId);
      dismissRequest(pendingRequest.rideId);
      if (trip) {
        setActiveTrip(trip);
        navigation?.navigate('DriverTrip');
      }
    } catch (caught) {
      // Usually 409: the request expired or was cancelled while deciding.
      setActionError(toApiError(caught).userMessage);
      dismissRequest(pendingRequest.rideId);
    } finally {
      setIsAnswering(false);
    }
  };

  const handleDecline = async () => {
    if (!pendingRequest) return;
    const { rideId } = pendingRequest;
    dismissRequest(rideId);
    try {
      await rejectRide(rideId, driverId);
    } catch {
      // Already expired server-side; nothing to do.
    }
  };

  return (
    <View style={styles.container}>
      <MapCanvas
        style={StyleSheet.absoluteFill as any}
        center={location}
        markers={markers}
        fitToMarkers={Boolean(pendingRequest)}
        showsUserLocation
      />

      <SafeAreaView edges={['top']} style={styles.headerSafeArea}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.statusDot, isOnline ? styles.dotOnline : styles.dotOffline]} />
            <Text style={styles.headerTitle}>{isOnline ? 'Online' : 'Offline'}</Text>
          </View>
          <View style={styles.driverIdPill}>
            <Feather name="user" size={12} color={colors.onSurfaceVariant} />
            <Text style={styles.driverIdText}>{driverId}</Text>
          </View>
        </View>
      </SafeAreaView>

      <SafeAreaView edges={['bottom']} style={styles.panelSafeArea}>
        <View style={styles.panel}>
          {!isOnline && (
            <View style={styles.idRow}>
              <Text style={styles.idLabel}>DRIVER ID</Text>
              <TextInput
                style={styles.idInput}
                value={idDraft}
                onChangeText={setIdDraft}
                onBlur={() => setDriverId(idDraft)}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="D200"
                placeholderTextColor={colors.onSurfaceVariant}
              />
              <Text style={styles.idHint}>Use a different ID on each test phone.</Text>
            </View>
          )}

          <Text style={styles.panelHint}>
            {isOnline
              ? 'Waiting for ride requests. Keep this screen open.'
              : 'Go online to start receiving requests near you.'}
          </Text>

          {location && (
            <Text style={styles.coordText}>
              {location.latitude.toFixed(5)}, {location.longitude.toFixed(5)}
            </Text>
          )}

          {!hasApiConfig() && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={14} color={colors.error} />
              <Text style={styles.errorText}>
                No backend configured. Set EXPO_PUBLIC_API_BASE_URL in .env
              </Text>
            </View>
          )}

          {(error || actionError) && (
            <View style={styles.errorRow}>
              <Feather name="alert-circle" size={14} color={colors.error} />
              <Text style={styles.errorText}>{actionError ?? error?.userMessage}</Text>
            </View>
          )}

          <Pressable
            style={[styles.toggleButton, isOnline ? styles.toggleOffline : styles.toggleOnline]}
            onPress={() => (isOnline ? goOffline() : goOnline())}
            disabled={isBusy}
            accessibilityRole="button"
          >
            {isBusy ? (
              <ActivityIndicator color={isOnline ? colors.error : colors.onPrimary} />
            ) : (
              <Text style={[styles.toggleText, isOnline && styles.toggleTextOffline]}>
                {isOnline ? 'GO OFFLINE' : 'GO ONLINE'}
              </Text>
            )}
          </Pressable>

          {/* Shown so each device can be confirmed against the right backend. */}
          <Text style={styles.envText} numberOfLines={1}>
            {env.apiBaseUrl || 'no backend URL'}
          </Text>
        </View>
      </SafeAreaView>

      {pendingRequest && (
        <RideRequestSheet
          request={pendingRequest}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onExpire={() => dismissRequest(pendingRequest.rideId)}
          isSubmitting={isAnswering}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceContainerHigh },
  headerSafeArea: { position: 'absolute', top: 0, left: 0, right: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.marginMobile,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.full,
    ...shadows.card,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  dotOnline: { backgroundColor: colors.statusGreen },
  dotOffline: { backgroundColor: colors.outline },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  driverIdPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  driverIdText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
  },
  panelSafeArea: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  panel: {
    margin: spacing.marginMobile,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 24,
    gap: spacing.md,
    ...shadows.elevated,
  },
  idRow: { gap: spacing.xs },
  idLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  idInput: {
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },
  idHint: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  panelHint: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  coordText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.outline,
    fontFamily: typography.dataMono.fontFamily,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  errorText: {
    flex: 1,
    fontSize: typography.labelSm.fontSize,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
  },
  toggleButton: {
    height: 56,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleOnline: { backgroundColor: colors.primary },
  toggleOffline: { backgroundColor: colors.errorContainer },
  toggleText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  toggleTextOffline: { color: colors.error },
  envText: {
    fontSize: 10,
    color: colors.outlineVariant,
    fontFamily: typography.dataMono.fontFamily,
    textAlign: 'center',
  },
});

export default DriverHomeScreen;
