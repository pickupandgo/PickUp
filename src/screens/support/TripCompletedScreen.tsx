import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockActiveTrip } from '../../data/mockData';
import Card from '../../components/molecules/Card';
import ListRow from '../../components/molecules/ListRow';
import Divider from '../../components/atoms/Divider';
import Button from '../../components/atoms/Button';
import { useBooking } from '../../state/BookingContext';
import { getVehicleDisplayName } from '../../utils/vehicleAssets';

export interface TripCompletedScreenProps {
  readonly onDone?: () => void;
  readonly onWriteReview?: () => void;
  readonly navigation?: any;
  readonly route?: any;
}

const TripCompletedScreen: React.FC<TripCompletedScreenProps & { navigation?: any; route?: any }> = ({
  onDone,
  onWriteReview,
  navigation,
  route,
}) => {
  const { ride, trip, draft, assignedDriver } = useBooking();

  // 1. Trip ID
  const displayTripId = useMemo(() => {
    return (
      route?.params?.tripId ||
      trip?.externalRef ||
      (trip?.id ? `TRIP-${trip.id.substring(0, 6).toUpperCase()}` : undefined) ||
      ride?.externalRef ||
      (ride?.id ? `TRIP-${ride.id.substring(0, 6).toUpperCase()}` : undefined) ||
      mockActiveTrip.id
    );
  }, [route?.params?.tripId, trip, ride]);

  // 2. Distance
  const displayDistance = useMemo(() => {
    const km =
      route?.params?.distanceKm ??
      trip?.totalDistanceKm ??
      ride?.totalDistanceKm ??
      (draft.quote ? draft.quote.distanceMeters / 1000 : undefined);
    if (typeof km === 'number' && !isNaN(km) && km > 0) {
      return `${km.toFixed(1)} km`;
    }
    return mockActiveTrip.distance;
  }, [route?.params?.distanceKm, trip, ride, draft.quote]);

  // 3. Vehicle Display Name
  const displayVehicle = useMemo(() => {
    const rawType =
      route?.params?.vehicleType ||
      assignedDriver?.vehicleType ||
      (trip as any)?.vehicleType ||
      ride?.vehicleType ||
      draft.vehicleType;
    return getVehicleDisplayName(rawType);
  }, [route?.params?.vehicleType, assignedDriver?.vehicleType, trip, ride?.vehicleType, draft.vehicleType]);

  // 4. Driver Name
  const displayDriver = useMemo(() => {
    return (
      route?.params?.driverName ||
      assignedDriver?.name ||
      (trip as any)?.driverName ||
      (ride as any)?.driverName ||
      mockActiveTrip.driverName
    );
  }, [route?.params?.driverName, assignedDriver?.name, trip, ride]);

  // 5. Total Fare
  const displayFare = useMemo(() => {
    const amount =
      route?.params?.fare ??
      trip?.fare ??
      ride?.fare ??
      (trip?.payablePaise ? trip.payablePaise / 100 : undefined) ??
      (ride?.payablePaise ? ride.payablePaise / 100 : undefined) ??
      (draft.quote ? draft.quote.payablePaise / 100 : undefined);
    if (typeof amount === 'number' && !isNaN(amount) && amount > 0) {
      return `₹${Math.round(amount)}`;
    }
    return mockActiveTrip.fare;
  }, [route?.params?.fare, trip, ride, draft.quote]);

  // 6. Route Stops
  const stops = useMemo(() => {
    // 1. Try trip
    if (trip?.pickup?.address || (trip?.stops && trip.stops.length > 0)) {
      const list: Array<{ label: string; address: string }> = [];
      const pickupAddr = trip.pickup?.address || draft.pickup?.address;
      if (pickupAddr) {
        list.push({ label: 'Pickup', address: pickupAddr });
      }
      if (trip.stops && trip.stops.length > 0) {
        trip.stops.forEach((s, i) => {
          const isSingle = trip.stops.length === 1;
          const isLast = i === trip.stops.length - 1;
          const label = isSingle ? 'Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
          list.push({
            label,
            address: s.location?.address || `Drop Location ${i + 1}`,
          });
        });
      } else if (trip.drop?.address) {
        list.push({ label: 'Drop', address: trip.drop.address });
      }
      if (list.length >= 2) return list;
    }

    // 2. Try ride
    const rideDrops = ride?.drops;
    if (ride?.pickup?.address || (rideDrops && rideDrops.length > 0)) {
      const list: Array<{ label: string; address: string }> = [];
      const pickupAddr = ride.pickup?.address || draft.pickup?.address;
      if (pickupAddr) {
        list.push({ label: 'Pickup', address: pickupAddr });
      }
      if (rideDrops && rideDrops.length > 0) {
        rideDrops.forEach((d, i) => {
          const isSingle = rideDrops.length === 1;
          const isLast = i === rideDrops.length - 1;
          const label = isSingle ? 'Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
          list.push({
            label,
            address: d.address || `Drop Location ${i + 1}`,
          });
        });
      } else if (ride.drop?.address) {
        list.push({ label: 'Drop', address: ride.drop.address });
      }
      if (list.length >= 2) return list;
    }

    // 3. Try draft
    if (draft.pickup?.address && draft.drops && draft.drops.length > 0) {
      const list: Array<{ label: string; address: string }> = [
        { label: 'Pickup', address: draft.pickup.address },
      ];
      draft.drops.forEach((d, i) => {
        const isSingle = draft.drops.length === 1;
        const isLast = i === draft.drops.length - 1;
        const label = isSingle ? 'Drop' : isLast ? 'Final Drop' : `Drop ${i + 1}`;
        list.push({
          label,
          address: d.address,
        });
      });
      return list;
    }

    return mockActiveTrip.stops;
  }, [trip, ride, draft]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Success Icon */}
        <View style={styles.heroSection}>
          <View style={styles.successCircle}>
            <Text style={styles.successIcon}>✓</Text>
          </View>
          <Text style={styles.title}>{strings.trip.completed}</Text>
          <Text style={styles.subtitle}>
            Your delivery has been completed successfully
          </Text>
        </View>

        {/* Trip Summary Card */}
        <Card variant="outlined" padding="none">
          <View style={styles.summaryHeader}>
            <Text style={styles.summaryTitle}>{strings.trip.summary}</Text>
            <Text style={styles.tripId}>{displayTripId}</Text>
          </View>
          <Divider />
          <ListRow
            title="Distance"
            trailing={
              <Text style={styles.valueText}>{displayDistance}</Text>
            }
          />
          <Divider />
          <ListRow
            title="Vehicle"
            trailing={
              <Text style={styles.valueText}>{displayVehicle}</Text>
            }
          />
          <Divider />
          <ListRow
            title="Driver"
            trailing={
              <Text style={styles.valueText}>{displayDriver}</Text>
            }
          />
          <Divider />
          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Total Fare</Text>
            <Text style={styles.fareAmount}>{displayFare}</Text>
          </View>
        </Card>

        {/* Route Summary */}
        <Card variant="filled" padding="md">
          {stops.map((stop, i) => (
            <View key={`stop-${i}`} style={styles.stopRow}>
              <View
                style={[
                  styles.stopDot,
                  i === 0
                    ? styles.pickupDot
                    : styles.dropDot,
                ]}
              />
              <View style={styles.stopInfo}>
                <Text style={styles.stopLabel}>{stop.label}</Text>
                <Text style={styles.stopAddress}>{stop.address}</Text>
              </View>
            </View>
          ))}
        </Card>
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <Button
          label="Write a Review"
          onPress={() =>
            onWriteReview ? onWriteReview() : navigation?.navigate('DriverRatingScreen')
          }
          variant="outline"
          size="lg"
          fullWidth
        />
        <Button
          label="Done"
          onPress={() => {
            onDone?.();
            navigation?.navigate('TripCompletedSummaryScreen');
          }}
          variant="primary"
          size="lg"
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    gap: spacing.stackGapMd,
    paddingBottom: spacing.xxxl,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingVertical: spacing.xxxl,
    gap: spacing.md,
  },
  successCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.statusGreen,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  successIcon: {
    fontSize: 36,
    color: colors.white,
    fontWeight: '700',
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
  },

  // Summary
  summaryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  summaryTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  tripId: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  valueText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  fareLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  fareAmount: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },

  // Stops
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 6,
  },
  pickupDot: {
    backgroundColor: colors.statusGreen,
  },
  dropDot: {
    backgroundColor: colors.primary,
  },
  stopInfo: {
    flex: 1,
    gap: 2,
  },
  stopLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  stopAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Footer
  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
});

export default TripCompletedScreen;
