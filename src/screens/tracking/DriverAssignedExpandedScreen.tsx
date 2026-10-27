import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Image,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useBooking } from '../../state/BookingContext';
import { getVehicleImage } from '../../utils/vehicleAssets';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoute } from '../../hooks/useRoute';
import type { GeoPoint } from '../../api/types';

export interface DriverAssignedExpandedScreenProps {
  readonly onBack?: () => void;
  readonly onTrackDriver?: () => void;
  readonly onCallDriver?: () => void;
  readonly onChatDriver?: () => void;
  readonly onCancelBooking?: () => void;
}

const DriverAssignedExpandedScreen: React.FC<
  DriverAssignedExpandedScreenProps & { navigation?: any; route?: any }
> = ({
  onBack,
  onTrackDriver,
  onCallDriver,
  onChatDriver,
  onCancelBooking,
  navigation,
  route,
}) => {
  const { assignedDriver, trip, ride, draft } = useBooking();

  const driverName =
    route?.params?.driverName ||
    assignedDriver?.name ||
    (trip as any)?.driverName ||
    (trip as any)?.driver?.name ||
    'Driver';

  const vehicleType =
    route?.params?.vehicleType ||
    assignedDriver?.vehicleType ||
    (trip as any)?.vehicleType ||
    ride?.vehicleType ||
    draft?.vehicleType ||
    'Mini Truck';

  const vehicleNumber =
    route?.params?.vehicleNumber ||
    (assignedDriver as any)?.vehicleNumber ||
    (assignedDriver as any)?.vehicleRegistrationNumber ||
    (trip as any)?.vehicleRegistration ||
    (ride as any)?.vehicleRegistration ||
    'RJ 19 XX 1234';

  const driverRating =
    (assignedDriver as any)?.rating != null
      ? Number((assignedDriver as any).rating).toFixed(1)
      : '4.8';

  const tripReference =
    trip?.id ||
    ride?.id ||
    trip?.paymentBookingId ||
    ride?.paymentBookingId ||
    '4910';

  const shortTripId =
    tripReference.length > 8 ? tripReference.slice(0, 8) : tripReference;

  // Real geographic points
  const pickupPoint: GeoPoint | undefined =
    trip?.pickup || ride?.pickup || draft?.pickup;

  const dropPoint: GeoPoint | undefined =
    trip?.drop ||
    ride?.drop ||
    (draft?.drops && draft.drops.length > 0 ? draft.drops[0] : undefined);

  const driverPoint: GeoPoint | undefined =
    assignedDriver?.latitude != null && assignedDriver?.longitude != null
      ? {
          latitude: assignedDriver.latitude,
          longitude: assignedDriver.longitude,
        }
      : undefined;

  // Real Road Route
  const routeOrigin = driverPoint ?? pickupPoint;
  const routeDestination = pickupPoint ?? dropPoint;
  const roadRoute = useRoute(routeOrigin, routeDestination);

  // Markers for MapCanvas
  const mapMarkers = useMemo(() => {
    const list: MapMarker[] = [];
    if (pickupPoint) {
      list.push({
        id: 'pickup',
        kind: 'pickup',
        coordinate: pickupPoint,
        title: 'Pickup Location',
      });
    }
    if (dropPoint) {
      list.push({
        id: 'drop',
        kind: 'drop',
        coordinate: dropPoint,
        title: 'Drop Location',
      });
    }
    if (driverPoint) {
      list.push({
        id: 'driver',
        kind: 'driver',
        coordinate: driverPoint,
        title: driverName,
        vehicleType,
        bearing: assignedDriver?.bearingDegrees,
      });
    }
    return list;
  }, [pickupPoint, dropPoint, driverPoint, driverName, vehicleType, assignedDriver]);

  // Real ETA and status calculation
  const etaData = useMemo(() => {
    if (trip?.status === 'DRIVER_ARRIVED' || (trip as any)?.arrivedAt) {
      return {
        arrived: true,
        title: 'Driver has arrived',
        subtitle: 'Driver is waiting at your pickup location.',
      };
    }
    if (driverPoint && pickupPoint) {
      const R = 6371e3; // metres
      const phi1 = (driverPoint.latitude * Math.PI) / 180;
      const phi2 = (pickupPoint.latitude * Math.PI) / 180;
      const dPhi = ((pickupPoint.latitude - driverPoint.latitude) * Math.PI) / 180;
      const dLam = ((pickupPoint.longitude - driverPoint.longitude) * Math.PI) / 180;
      const a =
        Math.sin(dPhi / 2) * Math.sin(dPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) * Math.sin(dLam / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      const distanceMeters = R * c;
      const km = (distanceMeters / 1000).toFixed(1);

      // Estimate ~25 km/h in city traffic (~416 m/min) with 1.3 road factor
      const minutes = Math.max(1, Math.round((distanceMeters * 1.3) / 416));
      return {
        arrived: false,
        title: `Arriving in ${minutes} mins`,
        subtitle: `Driver is ~${km} km away, heading to your pickup location.`,
      };
    }
    return {
      arrived: false,
      title: 'Driver on the way',
      subtitle: 'Driver is en route to your pickup location.',
    };
  }, [trip?.status, (trip as any)?.arrivedAt, driverPoint, pickupPoint]);

  const statusTitle = etaData.title;
  const statusSubtitle = etaData.subtitle;

  const pickupAddress =
    draft?.pickup?.address ||
    trip?.pickup?.address ||
    ride?.pickup?.address ||
    '228, Mansarover Colony, Jodhpur, Pal, Rajasthan';

  const dropsList = useMemo(() => {
    if (trip?.stops && trip.stops.length > 0) {
      return trip.stops.map((s, idx) => ({
        id: s.id || `stop-${idx}`,
        address: s.location?.address || `Drop Location ${idx + 1}`,
      }));
    }
    if (draft?.drops && draft.drops.length > 0) {
      return draft.drops.map((d, idx) => ({
        id: `draft-drop-${idx}`,
        address: d.address || `Drop Location ${idx + 1}`,
      }));
    }
    if (trip?.drop?.address) {
      return [{ id: 'trip-drop', address: trip.drop.address }];
    }
    return [{ id: 'default-drop', address: '6RX8+45 Kishan Nagar, Rajasthan, India' }];
  }, [trip, draft]);

  const handleTrackDriver = () => {
    if (onTrackDriver) {
      onTrackDriver();
      return;
    }
    navigation?.navigate('CustomerLiveTrackingScreen');
  };

  const handleCall = () => {
    if (onCallDriver) {
      onCallDriver();
      return;
    }
    const phone = (assignedDriver as any)?.phone || '+919876543210';
    Linking.openURL(`tel:${phone}`).catch(() => {
      navigation?.navigate('CallDriverScreen');
    });
  };

  const handleChat = () => {
    if (onChatDriver) {
      onChatDriver();
      return;
    }
    navigation?.navigate('ActiveTripChatScreen', {
      tripId: trip?.id,
      bookingId: trip?.paymentBookingId || ride?.paymentBookingId,
      driverName,
      vehicleType,
    });
  };

  const handleCancel = () => {
    if (onCancelBooking) {
      onCancelBooking();
      return;
    }
    navigation?.navigate('CancellationReasonScreen');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
            accessibilityRole="button"
          >
            <Feather name="arrow-left" size={22} color={colors.onSurfaceVariant} />
          </Pressable>
          <Text style={styles.headerTitle}>Trip Details</Text>
        </View>
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Real Interactive Map Header Area */}
        <View style={styles.mapHeaderContainer}>
          <MapCanvas
            style={styles.mapCanvas}
            center={driverPoint ?? pickupPoint}
            markers={mapMarkers}
            polyline={roadRoute}
            fitToMarkers={Boolean(pickupPoint && (dropPoint || driverPoint))}
          />

          {/* Floating Trip Subhead Pill over map */}
          <View style={styles.mapSubheadBadge}>
            <Text style={styles.mapSubheadText}>
              Driver Assigned • Trip #{shortTripId}
            </Text>
          </View>
        </View>

        {/* Content Area */}
        <View style={styles.contentContainer}>
          {/* Status Banner */}
          <View style={styles.statusBanner}>
            <View style={styles.statusBannerHeader}>
              <View style={styles.clockIconContainer}>
                <Feather name="clock" size={14} color="#1E3A8A" />
              </View>
              <Text style={styles.statusTitle}>{statusTitle}</Text>
            </View>
            <Text style={styles.statusSubtitle}>{statusSubtitle}</Text>
          </View>

          {/* Driver Info Card */}
          <View style={styles.driverCard}>
            <View style={styles.driverCardHeader}>
              <View style={styles.driverInfoLeft}>
                <View style={styles.driverAvatarContainer}>
                  <Image
                    source={getVehicleImage(vehicleType)}
                    style={{ width: 44, height: 44 }}
                    resizeMode="contain"
                  />
                </View>
                <View>
                  <Text style={styles.driverName}>{driverName}</Text>
                  <View style={styles.driverRatingPill}>
                    <Feather name="star" size={12} color="#EAB308" />
                    <Text style={styles.driverRatingText}>{driverRating}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.driverInfoRight}>
                <Text style={styles.vehicleName}>{vehicleType}</Text>
                <Text style={styles.vehicleNumber}>{vehicleNumber}</Text>
              </View>
            </View>

            {/* Communication Actions */}
            <View style={styles.communicationActions}>
              <Pressable
                style={styles.trackButton}
                onPress={handleTrackDriver}
                accessibilityRole="button"
              >
                <Text style={styles.trackButtonText}>Track Driver</Text>
              </Pressable>

              <Pressable
                style={styles.iconActionButton}
                onPress={handleCall}
                accessibilityRole="button"
                accessibilityLabel="Call driver"
              >
                <Feather name="phone" size={20} color="#1E293B" />
              </Pressable>

              <Pressable
                style={styles.iconActionButton}
                onPress={handleChat}
                accessibilityRole="button"
                accessibilityLabel="Chat with driver"
              >
                <Feather name="message-circle" size={20} color="#1E293B" />
              </Pressable>
            </View>
            <Text style={styles.privacyNote}>CALLS ARE MASKED FOR YOUR PRIVACY</Text>
          </View>

          {/* Logistics Details */}
          <View style={styles.logisticsCard}>
            <Text style={styles.logisticsTitle}>Logistics Details</Text>

            <View style={styles.timelineList}>
              <View style={styles.timelineLine} />

              {/* Pickup */}
              <View style={styles.timelineItem}>
                <View style={styles.timelineDotPickup} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineLabel}>PICKUP LOCATION</Text>
                  <Text style={styles.timelineText}>{pickupAddress}</Text>
                </View>
              </View>

              {/* Drops */}
              <View style={styles.timelineItem}>
                <View style={styles.timelineDotDrops} />
                <View style={styles.timelineContent}>
                  <View style={styles.dropsHeaderRow}>
                    <Text style={styles.timelineLabel}>DROP LOCATION</Text>
                    {dropsList.length > 1 && (
                      <View style={styles.dropsBadge}>
                        <Text style={styles.dropsBadgeText}>{dropsList.length} Locations</Text>
                      </View>
                    )}
                  </View>
                  {dropsList.map((drop, idx) => (
                    <Text key={drop.id} style={styles.timelineTextSub}>
                      {dropsList.length > 1 ? `${idx + 1}. ` : ''}
                      {drop.address}
                    </Text>
                  ))}
                </View>
              </View>
            </View>
          </View>

          {/* Cancel Action */}
          <Pressable
            style={styles.cancelButton}
            onPress={handleCancel}
            accessibilityRole="button"
          >
            <Text style={styles.cancelButtonText}>Cancel Booking</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 52,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconButton: {
    padding: 6,
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  scrollView: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  mapHeaderContainer: {
    width: '100%',
    height: 240,
    backgroundColor: '#E2E8F0',
    position: 'relative',
    overflow: 'hidden',
  },
  mapCanvas: {
    width: '100%',
    height: '100%',
  },
  mapSubheadBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  mapSubheadText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 14,
  },
  statusBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  statusBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  clockIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  statusSubtitle: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    marginLeft: 32,
  },
  driverCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  driverCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  driverInfoLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  driverAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  driverName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  driverRatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF9C3',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginTop: 3,
  },
  driverRatingText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#854D0E',
  },
  driverInfoRight: {
    alignItems: 'flex-end',
  },
  vehicleName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  vehicleNumber: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginTop: 2,
  },
  communicationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  trackButton: {
    flex: 1,
    backgroundColor: '#03071D',
    borderRadius: 24,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  iconActionButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyNote: {
    fontSize: 11,
    fontWeight: '600',
    color: '#94A3B8',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  logisticsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: borderRadius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  logisticsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 16,
  },
  timelineList: {
    position: 'relative',
    paddingLeft: 4,
  },
  timelineLine: {
    position: 'absolute',
    left: 8,
    top: 14,
    bottom: 24,
    width: 2,
    backgroundColor: '#E2E8F0',
  },
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    marginBottom: 18,
  },
  timelineDotPickup: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#16A34A',
    marginTop: 4,
    zIndex: 2,
  },
  timelineDotDrops: {
    width: 10,
    height: 10,
    borderRadius: 2,
    backgroundColor: '#DC2626',
    marginTop: 4,
    zIndex: 2,
  },
  timelineContent: {
    flex: 1,
  },
  timelineLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  timelineText: {
    fontSize: 13,
    color: '#0F172A',
    lineHeight: 18,
    fontWeight: '500',
  },
  dropsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  dropsBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  dropsBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563EB',
  },
  timelineTextSub: {
    fontSize: 13,
    color: '#334155',
    lineHeight: 18,
    marginTop: 2,
  },
  cancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FECACA',
    marginTop: 4,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#DC2626',
  },
});

export default DriverAssignedExpandedScreen;
