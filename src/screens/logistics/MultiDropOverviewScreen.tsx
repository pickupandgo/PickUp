import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { useBooking } from '../../state/BookingContext';

export interface DropStop {
  readonly id: string;
  readonly type: 'pickup' | 'drop';
  readonly label: string;
  readonly title: string;
  readonly landmark?: string;
  readonly receiver?: string;
}

export interface MultiDropOverviewScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: () => void;
  readonly onEditStop?: (id: string) => void;
  readonly onAddStop?: () => void;
  readonly stops?: readonly DropStop[];
}

const MultiDropOverviewScreen: React.FC<MultiDropOverviewScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  onEditStop,
  onAddStop,
  stops: stopsProp,
  navigation,
}) => {
  const { draft, removeDrop } = useBooking();
  const canConfirm = Boolean(stopsProp || draft.drops.length > 0);

  // Build the timeline from the real booking when there is one, so the review
  // reflects what the user actually chose. Falls back to sample stops for the
  // Gallery, where no booking exists.
  const stops = useMemo<readonly DropStop[]>(() => {
    if (stopsProp) return stopsProp;
    if (!draft.pickup && !draft.drops.length) return [];

    const built: DropStop[] = [];
    if (draft.pickup) {
      built.push({
        id: 'pickup',
        type: 'pickup',
        label: 'Pickup',
        title: draft.pickup.address || 'Pickup Location',
      });
    }
    draft.drops.forEach((drop, index) => {
      built.push({
        id: `drop-${index}`,
        type: 'drop',
        label: `Drop ${index + 1}`,
        title: drop.address,
        receiver: drop.receiverName,
      });
    });
    return built;
  }, [stopsProp, draft.pickup, draft.drops]);
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Review Route</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.timelineContainer}>
          {/* Vertical connecting line */}
          <View style={styles.timelineLine} />

          {stops.map((stop, index) => {
            const isPickup = stop.type === 'pickup';
            return (
              <View key={stop.id} style={styles.stopRow}>
                {/* Timeline Icon */}
                <View style={styles.stopIconContainer}>
                  <View style={[styles.stopIconInner, isPickup ? styles.stopIconPickup : styles.stopIconDrop]}>
                    {isPickup ? (
                      <Feather name="circle" size={16} color={colors.primary} />
                    ) : (
                      <Text style={styles.stopIndexText}>{index}</Text>
                    )}
                  </View>
                </View>

                {/* Stop Card */}
                <View style={styles.stopCard}>
                  <View style={styles.stopCardContent}>
                    <Text style={styles.stopLabel}>{stop.label}</Text>
                    <Text style={styles.stopTitle}>{stop.title}</Text>
                    
                    {stop.landmark && (
                      <View style={styles.detailRow}>
                        <Feather name="map-pin" size={14} color={colors.onSurfaceVariant} />
                        <Text style={styles.detailText}>Landmark: {stop.landmark}</Text>
                      </View>
                    )}
                    
                    {stop.receiver && (
                      <View style={styles.detailRow}>
                        <Feather name="user" size={14} color={colors.onSurfaceVariant} />
                        <Text style={styles.detailText}>Receiver: {stop.receiver}</Text>
                      </View>
                    )}
                  </View>

                  <Pressable
                    style={styles.editButton}
                    onPress={() =>
                      onEditStop
                        ? onEditStop(stop.id)
                        : navigation?.navigate(
                            isPickup ? 'SelectLocationScreen' : 'SelectDropLocationScreen',
                            { mode: 'edit', editTarget: isPickup ? { type: 'pickup' } : { type: 'drop', index: Number(stop.id.replace('drop-', '')) } }
                          )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${stop.label}`}
                  >
                    <Feather name="edit-2" size={18} color={colors.primary} />
                  </Pressable>
                  {!isPickup && !stopsProp && <Pressable
                    style={styles.deleteButton}
                    onPress={() => Alert.alert('Remove drop?', `Remove ${stop.label} from this route?`, [
                      { text: 'Keep drop', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: () => removeDrop(Number(stop.id.replace('drop-', ''))) },
                    ])}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${stop.label}`}
                  ><Feather name="trash-2" size={18} color={colors.error} /></Pressable>}
                </View>
              </View>
            );
          })}

          {/* Add Stop Button (Styled as a route item) */}
          <View style={styles.stopRow}>
            <View style={styles.stopIconContainer}>
              <View style={[styles.stopIconInner, styles.stopIconAdd]}>
                <Feather name="plus" size={16} color={colors.primary} />
              </View>
            </View>
            <Pressable
              style={styles.addStopButton}
              disabled={!stopsProp && draft.drops.length >= 5}
              onPress={() => (onAddStop ? onAddStop() : navigation?.navigate('SelectDropLocationScreen', { mode: 'stop' }))}
              accessibilityRole="button"
              accessibilityLabel="Add drop location"
            >
              <Text style={styles.addStopText}>Add Drop Location</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        {!canConfirm && <Text style={styles.emptyRouteHint}>Add at least one drop to continue.</Text>}
        <Pressable
          style={[styles.continueButton, !canConfirm && styles.continueButtonDisabled]}
          disabled={!canConfirm}
          onPress={() => {
            if (onContinue) onContinue();
            else navigation?.navigate('SelectVehicleScreen');
          }}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: !canConfirm }}
        >
          <Text style={styles.continueText}>CONFIRM ROUTE</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surfaceBright,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surfaceBright,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    paddingRight: 8,
  },
  headerSpacer: {
    width: 40,
  },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: 140,
  },

  // Timeline
  timelineContainer: {
    position: 'relative',
    marginTop: spacing.md,
  },
  timelineLine: {
    position: 'absolute',
    left: 23,
    top: 30,
    bottom: 50,
    width: 2,
    backgroundColor: colors.outlineVariant,
    borderRadius: 2,
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xxl,
    position: 'relative',
  },
  
  // Icon
  stopIconContainer: {
    position: 'relative',
    zIndex: 10,
    flexShrink: 0,
    marginTop: spacing.xs,
    marginRight: spacing.marginMobile,
  },
  stopIconInner: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: colors.surfaceBright,
  },
  stopIconPickup: {
    backgroundColor: colors.primaryFixed,
  },
  stopIconDrop: {
    backgroundColor: colors.surfaceContainerHighest,
  },
  stopIconAdd: {
    backgroundColor: colors.surfaceContainer,
    borderStyle: 'dashed',
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    width: 40,
    height: 40,
    marginLeft: 4,
  },
  stopIndexText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Card
  stopCard: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.marginMobile,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    ...shadows.ghostShadow,
  },
  stopCardContent: {
    flex: 1,
    gap: 4,
  },
  stopLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.outline,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  stopTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  detailText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  editButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.errorContainer,
    marginLeft: spacing.xs,
  },

  // Add Stop
  addStopButton: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.marginMobile,
    borderWidth: 1,
    borderColor: colors.primary + '40', // 25% opacity
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  addStopText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceBright,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    ...shadows.ghostShadow,
  },
  continueButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
  },
  continueButtonDisabled: { backgroundColor: colors.surfaceContainerHighest },
  emptyRouteHint: { ...typography.labelSm, color: colors.error, textAlign: 'center', marginBottom: spacing.sm },
  continueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default MultiDropOverviewScreen;
