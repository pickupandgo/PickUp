import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { mockActiveTrip } from '../../data/mockData';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { MultiStopTimeline } from '../../components/organisms/MultiStopTimeline';
import { DriverMap, MapOverlay, RouteData, StopType } from '../../map';
import { useDriverLocation } from '../../location';
import { useActiveTrip } from '../../hooks/useActiveTrip';
import type { HomeScreenProps } from '../../types/navigation';

export interface ArrivedAtPickupScreenProps {
  readonly navigation: HomeScreenProps<'ArrivedAtPickup'>['navigation'];
  readonly route: HomeScreenProps<'ArrivedAtPickup'>['route'];
  readonly testID?: string;
}

export const ArrivedAtPickupScreen: React.FC<ArrivedAtPickupScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { currentLocation } = useDriverLocation();
  const { tripId, stopId } = route.params;
  const trip = useActiveTrip() || mockActiveTrip;
  const stop = trip.stops.find((s) => s.id === stopId) ?? trip.stops[0];

  const routeData: RouteData = {
    polylinePoints: [],
    stops: stop ? [
      {
        id: stop.id,
        type: stop.type as StopType,
        coordinate: {
          latitude: stop.latitude,
          longitude: stop.longitude,
        },
        isCurrent: true,
      }
    ] : []
  };

  const handleVerifyPickup = useCallback(() => {
    navigation.navigate('PickupOTP', { tripId, stopId });
  }, [navigation, tripId, stopId]);

  return (
    <View style={styles.safeArea} testID={testID}>
      {/* Absolute back button overlay on map */}
      <SafeAreaView edges={['top']} style={styles.backButtonContainer}>
        <Icon 
          name="arrow_back" 
          style={styles.backButtonIcon} 
        />
        <View style={styles.backButtonTouch} onTouchEnd={() => navigation.goBack()} />
      </SafeAreaView>

      <View style={styles.mapContainer}>
        <DriverMap
          currentLocation={currentLocation || undefined}
          routeData={routeData}
          followDriver={true}
          showControls={false}
        />
      </View>

      <View style={styles.bottomPanel}>
        <View style={styles.arrivedBadgeContainer}>
          <View style={styles.arrivedBadge}>
            <Text style={styles.arrivedBadgeText}>ARRIVED AT PICKUP</Text>
          </View>
        </View>

        <View style={styles.instructionRow}>
          <Text style={styles.instructionText}>Sender loading goods...</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.timelineContainer}>
          <MultiStopTimeline stops={trip.stops} currentStopIndex={trip.currentStopIndex} />
        </View>

        <PrimaryButton
          label="ENTER SENDER OTP"
          onPress={handleVerifyPickup}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  backButtonContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 10,
    padding: spacing.md,
  },
    backButtonTouch: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 60,
    height: 60,
    zIndex: 11,
  },
  backButtonIcon: {
    fontSize: 24,
    color: colors.onSurface,
    backgroundColor: colors.surface,
    padding: spacing.xs,
    borderRadius: borderRadius.full,
    ...shadows.sm,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  bottomPanel: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingTop: spacing.md,
    ...shadows.lg,
    marginTop: -20,
  },
  arrivedBadgeContainer: {
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  arrivedBadge: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  arrivedBadgeText: {
    ...typography.labelSm,
    color: '#333333',
    fontWeight: '700',
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  distanceText: {
    ...typography.headlineMd,
    color: colors.onSurface,
    fontWeight: '600',
  },
  etaText: {
    ...typography.bodyLg,
    color: colors.onSurfaceVariant,
  },
  instructionRow: {
    marginTop: spacing.xs,
  },
  instructionText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
    marginVertical: spacing.md,
  },
  timelineContainer: {
    paddingHorizontal: spacing.xs,
    marginBottom: spacing.lg,
  },
});

export default ArrivedAtPickupScreen;
