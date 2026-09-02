import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { TripOfferSheet } from '../../components/organisms/TripOfferSheet';
import { StatusPill } from '../../components/atoms/StatusPill';
import { DriverMap, MapOverlay, RouteData, StopType } from '../../map';
import { useDriverLocation } from '../../location';
import type { HomeScreenProps } from '../../types/navigation';
import {
  acceptRideRequest,
  rejectRideRequest,
  getTripIdForRide,
} from '../../services/engine/dispatch';

export interface NewTripOfferScreenProps {
  readonly navigation: HomeScreenProps<'TripOffer'>['navigation'];
  readonly route: HomeScreenProps<'TripOffer'>['route'];
  readonly testID?: string;
}

export const NewTripOfferScreen: React.FC<NewTripOfferScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { offer, driverId } = route.params;
  const { currentLocation } = useDriverLocation();
  const [offerState, setOfferState] = useState<'pending' | 'accepted' | 'expired'>('pending');
  const [submitting, setSubmitting] = useState(false);

  const offerRouteData: RouteData = {
    polylinePoints: [], // Populated in later routing phase
    stops: [
      {
        id: offer.pickupStop.id,
        type: 'pickup' as StopType,
        coordinate: {
          latitude: offer.pickupStop.latitude,
          longitude: offer.pickupStop.longitude,
        },
      },
      ...offer.dropStops.map((drop, index) => ({
        id: drop.id,
        type: 'drop' as StopType,
        coordinate: {
          latitude: drop.latitude,
          longitude: drop.longitude,
        },
        label: offer.dropStops.length > 1 ? String(index + 1) : undefined,
      })),
    ],
  };

  const handleAccept = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setOfferState('accepted');
    try {
      await acceptRideRequest(offer.id, driverId);
      const tripId = await getTripIdForRide(offer.id).catch(() => null);
      navigation.navigate('ActiveTrip', { tripId: tripId ?? offer.id });
    } catch (e) {
      setSubmitting(false);
      setOfferState('pending');
      Alert.alert(
        'Request unavailable',
        'This trip was cancelled or taken by someone else.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );
    }
  }, [submitting, offer.id, driverId, navigation]);

  const handleDecline = useCallback(() => {
    rejectRideRequest(offer.id, driverId).catch(() => {});
    navigation.goBack();
  }, [offer.id, driverId, navigation]);

  const handleExpired = useCallback(() => {
    setOfferState('expired');
    setTimeout(() => {
      navigation.goBack();
    }, 2000);
  }, [navigation]);

  const pickupAddress = offer.pickupStop.address;
  const dropAddress = offer.dropStops[0]?.address ?? '';

  return (
    <View style={styles.flex1} testID={testID}>
      {/* Scrollable Content */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <Text style={styles.headerTitle}>TRIP OFFER</Text>
          <Text style={styles.headerId}>ID: {offer.id.slice(0, 8).toUpperCase()}</Text>
        </SafeAreaView>

        {/* Embedded Map Card */}
        <View style={styles.mapCard}>
          <DriverMap
            currentLocation={currentLocation || undefined}
            routeData={offerRouteData}
            showControls={false}
            followDriver={true}
          />

          {/* Overlays for Pending State (Top) */}
          {(offerState === 'pending' || offerState === 'expired') && (
            <MapOverlay position="top" style={styles.topPillsContainer}>
              <StatusPill
                label="NEW REQUEST"
                variant="default"
                iconName="circle"
                style={styles.newRequestPill}
              />
              {offerState === 'expired' && (
                <StatusPill label="EXPIRED" variant="danger_outline" iconName="timer" />
              )}
            </MapOverlay>
          )}

          {/* Metrics Overlay (Inside Map at Bottom) */}
          <MapOverlay position="bottom" style={styles.metricsOverlay}>
            <View style={styles.metricsCard}>
              <Text style={styles.metricValue}>{offer.totalDistanceKm} km</Text>
            </View>
          </MapOverlay>
        </View>

        {/* Stops List */}
        <View style={styles.stopsList}>
          {/* Pickup */}
          <View style={styles.stopRow}>
            <View style={styles.iconTimeline}>
              <Icon name="location_on" style={styles.pickupIcon} />
              <View style={styles.timelineLine} />
            </View>
            <View style={styles.stopContent}>
              <Text style={styles.stopLabel}>PICKUP</Text>
              <Text style={styles.stopAddress} numberOfLines={1}>
                {pickupAddress}
              </Text>
            </View>
          </View>

          {/* Dropoff */}
          <View style={styles.stopRow}>
            <View style={styles.iconTimeline}>
              <Icon name="flag" style={styles.dropoffIcon} />
            </View>
            <View style={styles.stopContent}>
              <Text style={styles.stopLabel}>DROPOFF</Text>
              <Text style={styles.stopAddress} numberOfLines={1}>
                {dropAddress}
              </Text>
            </View>
          </View>
        </View>

        {/* Guaranteed Earnings Card */}
        <View style={styles.guaranteedCard}>
          <View>
            <Text style={styles.guaranteedLabel}>ESTIMATED EARNINGS</Text>
            <Text style={styles.guaranteedValue}>
              {offer.currency}
              {offer.estimatedEarning.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </Text>
          </View>
          <View style={styles.demandBadge}>
            <Text style={styles.demandBadgeTop}>{offer.vehicleType}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Area: Trip Offer Sheet for Pending */}
      {(offerState === 'pending' || offerState === 'expired') && (
        <TripOfferSheet
          offer={offer}
          onAccept={handleAccept}
          onDecline={handleDecline}
          onExpired={handleExpired}
        />
      )}

      {/* Accepted Confirmation Overlay */}
      {offerState === 'accepted' && (
        <SafeAreaView edges={['bottom']} style={styles.confirmationContainer}>
          <View style={styles.confirmationCard}>
            <View style={styles.confirmationIconContainer}>
              <Icon name="check" style={styles.confirmationIcon} />
            </View>
            <Text style={styles.confirmationTitle}>Trip Accepted!</Text>
            <Text style={styles.confirmationSubtitle}>Redirecting to Navigation...</Text>
          </View>
        </SafeAreaView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  flex1: {
    flex: 1,
    backgroundColor: '#FAFAFC', // Slightly grey background to match Figma
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 150, // space for bottom overlays
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  headerTitle: {
    ...typography.headlineMd,
    fontWeight: 'bold',
    color: '#000022',
  },
  headerId: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  mapCard: {
    height: 260,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    marginBottom: spacing.lg,
    backgroundColor: colors.surfaceContainerLow,
  },
  topPillsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
    width: '100%',
  },
  newRequestPill: {
    ...shadows.sm,
  },
  metricsOverlay: {
    bottom: 8,
    right: 8,
    alignItems: 'flex-end',
  },
  metricsCard: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  metricValue: {
    ...typography.labelSm,
    color: colors.surface,
  },
  stopsList: {
    gap: 0,
    marginBottom: spacing.lg,
  },
  stopRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  iconTimeline: {
    alignItems: 'center',
    width: 24,
  },
  pickupIcon: {
    fontSize: 20,
    color: '#000022', // Match header title color
  },
  dropoffIcon: {
    fontSize: 20,
    color: colors.onSurfaceVariant,
  },
  timelineLine: {
    width: 1,
    height: 40,
    backgroundColor: colors.outlineVariant,
    marginVertical: 4,
  },
  stopContent: {
    flex: 1,
    paddingBottom: spacing.md,
  },
  stopLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  stopAddress: {
    ...typography.bodyLg,
    color: colors.onSurface,
    marginTop: 2,
  },
  stopNotes: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  guaranteedCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F5F5F7',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  guaranteedLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  guaranteedValue: {
    ...typography.displaySm,
    color: '#000022',
    marginTop: 4,
  },
  demandBadge: {
    backgroundColor: '#E8EAF6',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.gutter,
    paddingVertical: 6,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#C5CAE9',
  },
  demandBadgeTop: {
    ...typography.labelSm,
    color: '#3F51B5',
    fontWeight: '600',
  },
  demandBadgeBottom: {
    ...typography.labelSm,
    color: '#3F51B5',
    fontSize: 10,
  },
  confirmationContainer: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
  },
  confirmationCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadows.lg,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  confirmationIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#000022',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  confirmationIcon: {
    color: colors.surface,
    fontSize: 24,
  },
  confirmationTitle: {
    ...typography.headlineSm,
    color: '#000022',
    fontWeight: 'bold',
  },
  confirmationSubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    marginTop: 4,
  },
});

export default NewTripOfferScreen;
