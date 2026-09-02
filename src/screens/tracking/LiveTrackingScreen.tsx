import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { mockActiveTrip } from '../../data/mockData';
import TopAppBar from '../../components/organisms/TopAppBar';
import StatusBadge from '../../components/atoms/StatusBadge';

export interface LiveTrackingScreenProps {
  readonly onBack?: () => void;
  readonly onCallDriver?: () => void;
  readonly onChat?: () => void;
  readonly onShare?: () => void;
}

const LiveTrackingScreen: React.FC<LiveTrackingScreenProps & { navigation?: any }> = ({
  onBack,
  onCallDriver,
  onChat,
  onShare,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <TopAppBar
        title="Live Tracking"
        leadingIcon={<Text style={styles.backIcon}>←</Text>}
        onLeadingPress={() => (onBack ? onBack() : navigation?.goBack())}
        trailingIcon={
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        }
      />

      {/* Map Placeholder Area */}
      <View style={styles.mapContainer}>
        <View style={styles.mapPlaceholder}>
          {/* Pickup marker */}
          <View style={[styles.marker, styles.pickupMarker]}>
            <View style={styles.markerDot} />
            <Text style={styles.markerLabel}>Pickup</Text>
          </View>

          {/* Route line */}
          <View style={styles.routeLine} />

          {/* Driver marker */}
          <View style={[styles.marker, styles.driverMarker]}>
            <View style={styles.driverDotOuter}>
              <Text style={styles.driverDotIcon}>🚚</Text>
            </View>
            <Text style={styles.driverTimeLabel}>10s ago</Text>
          </View>

          {/* Drop marker */}
          <View style={[styles.marker, styles.dropMarker]}>
            <View style={styles.dropDotOuter}>
              <Text style={styles.dropDotText}>1</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Bottom Info Card */}
      <View style={styles.bottomSheet}>
        <View style={styles.handleWrapper}>
          <View style={styles.handle} />
        </View>

        {/* Drop Info */}
        <View style={styles.dropInfoRow}>
          <View style={styles.dropInfoText}>
            <Text style={styles.dropTitle}>
              Drop {mockActiveTrip.stops.findIndex(s => s.status === 'current') + 1} of {mockActiveTrip.stops.length}
            </Text>
            <Text style={styles.dropSubtitle}>
              Arriving at {mockActiveTrip.stops[1].address.split(',')[0]} in{' '}
              <Text style={styles.boldText}>8 mins</Text>
            </Text>
          </View>
          <StatusBadge label="On time" variant="success" />
        </View>

        {/* Progress Bar */}
        <View style={styles.progressBar}>
          <View style={styles.progressFill} />
        </View>

        {/* Driver Info */}
        <View style={styles.driverInfoRow}>
          <View style={styles.driverAvatar}>
            <Text style={styles.driverAvatarText}>👤</Text>
          </View>
          <View style={styles.driverDetails}>
            <Text style={styles.driverName}>{mockActiveTrip.driverName}</Text>
            <Text style={styles.driverMeta}>
              ⭐ {mockActiveTrip.driverRating} • {mockActiveTrip.vehicleType}
            </Text>
          </View>
          <View style={styles.vehicleBadge}>
            <Text style={styles.vehicleBadgeText}>
              {mockActiveTrip.vehicleNumber}
            </Text>
          </View>
        </View>

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          <Pressable
            style={styles.actionButton}
            onPress={() => (onCallDriver ? onCallDriver() : navigation?.navigate('CallDriverScreen'))}
            accessibilityRole="button"
            accessibilityLabel="Call driver"
          >
            <Text style={styles.actionIcon}>📞</Text>
            <Text style={styles.actionLabel}>Call</Text>
          </Pressable>
          <Pressable
            style={styles.actionButton}
            onPress={() => (onChat ? onChat() : navigation?.navigate('ActiveTripChatScreen'))}
            accessibilityRole="button"
            accessibilityLabel="Chat with driver"
          >
            <Text style={styles.actionIcon}>💬</Text>
            <Text style={styles.actionLabel}>Chat</Text>
          </Pressable>
          <Pressable
            style={styles.actionButtonCircle}
            onPress={() => (onShare ? onShare() : navigation?.navigate('ShareTrackingSheetScreen'))}
            accessibilityRole="button"
            accessibilityLabel="Share tracking"
          >
            <Text style={styles.actionIcon}>🔗</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  backIcon: {
    fontSize: 22,
    color: colors.onSurface,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.statusRed,
  },
  liveText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '700',
    color: colors.statusRed,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Map
  mapContainer: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  mapPlaceholder: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  marker: {
    position: 'absolute',
    alignItems: 'center',
  },
  pickupMarker: {
    top: '15%',
    left: '20%',
  },
  markerDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  markerLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: spacing.xs,
  },
  routeLine: {
    position: 'absolute',
    top: '22%',
    left: '23%',
    width: 3,
    height: '40%',
    backgroundColor: colors.primary,
    transform: [{ rotate: '25deg' }],
  },
  driverMarker: {
    top: '45%',
    left: '40%',
  },
  driverDotOuter: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverDotIcon: {
    fontSize: 20,
  },
  driverTimeLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
  },
  dropMarker: {
    top: '62%',
    left: '42%',
  },
  dropDotOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.outlineVariant,
  },
  dropDotText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Bottom Sheet
  bottomSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    ...shadows.elevated,
  },
  handleWrapper: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.outlineVariant,
  },

  // Drop Info
  dropInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  dropInfoText: {
    flex: 1,
    gap: spacing.xs,
  },
  dropTitle: {
    fontSize: typography.headlineMd.fontSize,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  dropSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    lineHeight: typography.bodyMd.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  boldText: {
    fontWeight: '700',
    color: colors.onSurface,
  },

  // Progress
  progressBar: {
    height: 6,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: 3,
    marginBottom: spacing.lg,
  },
  progressFill: {
    height: 6,
    width: '40%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },

  // Driver Info
  driverInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
  },
  driverAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarText: { fontSize: 20 },
  driverDetails: {
    flex: 1,
    gap: 2,
  },
  driverName: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  driverMeta: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  vehicleBadge: {
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vehicleBadgeText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.md,
  },
  actionButtonCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.outlineHairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: { fontSize: 16 },
  actionLabel: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
});

export default LiveTrackingScreen;
