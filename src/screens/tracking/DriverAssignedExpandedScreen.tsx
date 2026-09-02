import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  ImageBackground,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface DriverAssignedExpandedScreenProps {
  readonly onBack?: () => void;
  readonly onTrackDriver?: () => void;
  readonly onCallDriver?: () => void;
  readonly onChatDriver?: () => void;
  readonly onCancelBooking?: () => void;
}

const DriverAssignedExpandedScreen: React.FC<DriverAssignedExpandedScreenProps & { navigation?: any }> = ({
  onBack,
  onTrackDriver,
  onCallDriver,
  onChatDriver,
  onCancelBooking,
  navigation,
}) => {
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

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {/* Map Header Area */}
        <View style={styles.mapHeaderContainer}>
          <ImageBackground
            source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuA28cLUnVVRVaSHJOdRuzgZjKppEqFuT5so4q4W35xmGab0vLLcVZXOWINiIy68iUgn1VrfXRMfVXUkf0kBaQEefit23WUXhFbwvfRlPGkyqadWtqvDvsNDDazyD9MzN46EsEG-fyYTGM51950UdOMOp2wCwM9PKS7LLgNKbR-XThbtH7Ii7MtWc3NCD9LoRv5ajpMA35oFhTEquN7GaDHQVD7Bo_oSeu0wepcZoQgJXgsgiPjlEHqb' }}
            style={styles.mapCanvas}
            imageStyle={{ opacity: 0.6 }}
          >
            <View style={styles.mapGradient} />
            
            {/* Mock Map Elements */}
            <View style={styles.truckMarkerContainer}>
              <View style={styles.truckMarker}>
                <Feather name="truck" size={16} color={colors.primary} />
              </View>
              <View style={styles.etaPill}>
                <Text style={styles.etaPillText}>4 MIN</Text>
              </View>
            </View>

            <View style={styles.pickupMarkerContainer}>
              <View style={styles.pickupMarkerOuter}>
                <View style={styles.pickupMarkerInner} />
              </View>
            </View>
          </ImageBackground>
        </View>

        {/* Content Area */}
        <View style={styles.contentContainer}>
          
          {/* Status Banner */}
          <View style={styles.statusBanner}>
            <View style={styles.statusBannerHeader}>
              <View style={styles.clockIconContainer}>
                <Feather name="clock" size={14} color={colors.onSecondaryContainer} />
              </View>
              <Text style={styles.statusTitle}>Arriving in 4 mins</Text>
            </View>
            <Text style={styles.statusSubtitle}>Driver is on the way to your pickup location.</Text>
          </View>

          {/* Driver Info Card */}
          <View style={styles.driverCard}>
            <View style={styles.driverCardHeader}>
              <View style={styles.driverInfoLeft}>
                <View style={styles.driverAvatarContainer}>
                  <Image
                    source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAkxoEdQOf30gW6pDewFHY2PByhn6TVKuXsi_CmFRhj5u6pTDQXutuhNshIaV6Z8D4n9PD2i1WO2CS8Vw78R4JL4VF6Zgm8TSP4wOIO-iKdZzA-XiP0zY_ZjaUYA43Tk8QqXaM6Sjb04XuD5_weeYTIdXgZgy119Gnutg9LTzoT8Y9eNPc-rYTmvE0mXsbk1g7N6oPptLsfil-yqnPwi1DnlmsdbIinA4C-IIgmd4ygZ7gA4lhMm7nZ' }}
                    style={styles.driverAvatar}
                  />
                </View>
                <View>
                  <Text style={styles.driverName}>Ramesh Kumar</Text>
                  <View style={styles.driverRatingPill}>
                    <Feather name="star" size={12} color={colors.onTertiaryContainer} />
                    <Text style={styles.driverRatingText}>4.8</Text>
                  </View>
                </View>
              </View>

              <View style={styles.driverInfoRight}>
                <Text style={styles.vehicleName}>Tata Ace</Text>
                <Text style={styles.vehicleNumber}>RJ 19 XX 1234</Text>
              </View>
            </View>

            {/* Communication Actions */}
            <View style={styles.communicationActions}>
              <Pressable
                style={styles.trackButton}
                onPress={() => (onTrackDriver ? onTrackDriver() : navigation?.navigate('CustomerLiveTrackingScreen'))}
                accessibilityRole="button"
              >
                <Text style={styles.trackButtonText}>Track Driver</Text>
              </Pressable>
              
              <Pressable
                style={styles.iconActionButton}
                onPress={() => (onCallDriver ? onCallDriver() : navigation?.navigate('CallDriverScreen'))}
                accessibilityRole="button"
              >
                <Feather name="phone" size={20} color={colors.onSecondaryContainer} />
              </Pressable>
              
              <Pressable
                style={styles.iconActionButton}
                onPress={() => (onChatDriver ? onChatDriver() : navigation?.navigate('ActiveTripChatScreen'))}
                accessibilityRole="button"
              >
                <Feather name="message-circle" size={20} color={colors.onSecondaryContainer} />
              </Pressable>
            </View>
            <Text style={styles.privacyNote}>Calls are masked for your privacy</Text>
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
                  <Text style={styles.timelineLabel}>PICKUP</Text>
                  <Text style={styles.timelineText}>Sardarpura Warehouse</Text>
                </View>
              </View>

              {/* Drops */}
              <View style={styles.timelineItem}>
                <View style={styles.timelineDotDrops} />
                <View style={styles.timelineContent}>
                  <View style={styles.dropsHeaderRow}>
                    <Text style={styles.timelineLabel}>DROPS</Text>
                    <View style={styles.dropsBadge}>
                      <Text style={styles.dropsBadgeText}>3 Locations</Text>
                    </View>
                  </View>
                  <Text style={styles.timelineTextSub}>1. Ratanada Hub</Text>
                  <Text style={styles.timelineTextSub}>2. Pal Road</Text>
                  <Text style={styles.timelineTextSub}>3. Basni Phase II</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Cancel Action */}
          <Pressable
            style={styles.cancelButton}
            onPress={() => (onCancelBooking ? onCancelBooking() : navigation?.navigate('CancellationReasonScreen'))}
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
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },

  scrollView: {
    flex: 1,
  },
  
  // Map Header Area
  mapHeaderContainer: {
    width: '100%',
    height: 353,
    backgroundColor: colors.surfaceContainer,
  },
  mapCanvas: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 128, // 32rem equivalent roughly
    // Fallback for native linear gradient (solid color with opacity is simpler, but a library would be better. using a simple view here)
    backgroundColor: colors.surface,
    opacity: 0.8,
  },
  truckMarkerContainer: {
    position: 'absolute',
    top: '33%',
    left: '25%',
    alignItems: 'center',
  },
  truckMarker: {
    backgroundColor: colors.surfaceContainerLowest,
    padding: spacing.xs,
    borderRadius: borderRadius.full,
    ...shadows.sm,
  },
  etaPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
    borderRadius: borderRadius.xs,
    marginTop: 4,
    ...shadows.sm,
  },
  etaPillText: {
    fontSize: typography.labelCaps.fontSize,
    color: colors.onPrimary,
    fontFamily: typography.labelCaps.fontFamily,
    fontWeight: '700',
  },
  pickupMarkerContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    alignItems: 'center',
  },
  pickupMarkerOuter: {
    backgroundColor: colors.primary,
    padding: 6,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.surfaceContainerLowest,
    ...shadows.sm,
  },
  pickupMarkerInner: {
    width: 8,
    height: 8,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.full,
  },

  // Content Area
  contentContainer: {
    paddingHorizontal: spacing.marginMobile,
    marginTop: -32, // overlapping map
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },

  // Status Banner
  statusBanner: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerLow,
    ...shadows.card,
  },
  statusBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  clockIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Driver Card
  driverCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerLow,
    ...shadows.card,
    gap: spacing.xl,
  },
  driverCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  driverInfoLeft: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  driverAvatarContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 2,
    borderColor: colors.surface,
    overflow: 'hidden',
  },
  driverAvatar: {
    width: '100%',
    height: '100%',
  },
  driverName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  driverRatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceContainerLow,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    marginTop: 4,
    alignSelf: 'flex-start',
  },
  driverRatingText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  driverInfoRight: {
    alignItems: 'flex-end',
  },
  vehicleName: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  vehicleNumber: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  communicationActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerLow,
  },
  trackButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  trackButtonText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onPrimary,
    fontFamily: typography.bodyMd.fontFamily,
    fontWeight: '500',
  },
  iconActionButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.secondaryContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privacyNote: {
    fontSize: typography.labelCaps.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textAlign: 'center',
    opacity: 0.7,
    textTransform: 'uppercase',
  },

  // Logistics Card
  logisticsCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerLow,
    ...shadows.card,
  },
  logisticsTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.xl,
  },
  timelineList: {
    position: 'relative',
    paddingLeft: spacing.xl,
  },
  timelineLine: {
    position: 'absolute',
    left: 5,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: colors.surfaceContainerHigh,
  },
  timelineItem: {
    position: 'relative',
    marginBottom: spacing.xl,
  },
  timelineDotPickup: {
    position: 'absolute',
    left: -26,
    top: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
    borderWidth: 4,
    borderColor: colors.surfaceContainerLowest,
  },
  timelineDotDrops: {
    position: 'absolute',
    left: -26,
    top: 4,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  timelineContent: {
    paddingLeft: spacing.xs,
  },
  timelineLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelSm.letterSpacing,
    marginBottom: 4,
  },
  timelineText: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  dropsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  dropsBadge: {
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  dropsBadgeText: {
    fontSize: typography.labelCaps.fontSize,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelCaps.fontFamily,
  },
  timelineTextSub: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 4,
  },

  // Cancel Action
  cancelButton: {
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    marginTop: spacing.md,
  },
  cancelButtonText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.error,
    fontFamily: typography.bodyMd.fontFamily,
  },
});

export default DriverAssignedExpandedScreen;
