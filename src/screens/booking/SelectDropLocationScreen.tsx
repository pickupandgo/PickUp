import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { reverseGeocode } from '../../api/geocoding';
import type { GeoPoint } from '../../api/types';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';
import { useBooking } from '../../state/BookingContext';

export interface SelectDropLocationScreenProps {
  readonly onBack?: () => void;
  readonly onConfirm?: () => void;
  readonly onAddAnother?: () => void;
}

const SelectDropLocationScreen: React.FC<SelectDropLocationScreenProps & { navigation?: any }> = ({
  onBack,
  onConfirm,
  onAddAnother,
  navigation,
}) => {
  const { draft, commitPendingDrop, setPendingDrop } = useBooking();
  // The address chosen in search; falls back to the last confirmed drop when
  // this screen is reopened to review an existing stop.
  const selectedPlace = draft.pendingDrop ?? draft.drops[draft.drops.length - 1];

  const [searchQuery, setSearchQuery] = useState(selectedPlace?.address ?? '');
  const [instructions, setInstructions] = useState('');
  const insets = useSafeAreaInsets();

  const dropLabel = `Drop ${draft.drops.length + (draft.pendingDrop ? 1 : 0)}`;

  // Show the pickup as a marker so the user can see where they're going FROM.
  const pickupMarker = useMemo<readonly MapMarker[]>(
    () =>
      draft.pickup
        ? [{ id: 'pickup', kind: 'pickup', coordinate: draft.pickup, title: 'Pickup' }]
        : [],
    [draft.pickup]
  );

  // Panning the map picks a new drop location. Reverse-geocoding turns the
  // coordinate under the centre pin into an address the user can read.
  const handleRegionChange = useCallback(
    (point: GeoPoint) => {
      void (async () => {
        let address = 'Dropped pin';
        try {
          const resolved = await reverseGeocode(point);
          if (resolved) address = resolved;
        } catch {
          // Fine to fall through: the map fix is enough on its own.
        }
        setSearchQuery(address);
        setPendingDrop({ ...point, address });
      })();
    },
    [setPendingDrop]
  );

  const handleConfirm = () => {
    commitPendingDrop();
    onConfirm?.();
    // Pickup is already set on HomeScreen, so go straight to the route review
    // rather than asking for pickup again.
    navigation?.navigate('MultiDropOverviewScreen');
  };

  return (
    <View style={styles.container}>
      {/* Real map. The centre pin doubles as the drop selector; panning drives
          reverse-geocoding and updates the pending drop shown in the sheet. */}
      <MapCanvas
        style={styles.mapCanvas}
        center={selectedPlace}
        markers={pickupMarker}
        showsUserLocation
        onRegionChangeComplete={handleRegionChange}
      >
        {/* Top Controls Overlay */}
        <View style={[styles.topControls, { paddingTop: Math.max(insets.top, spacing.marginMobile) }]}>
          {/* Back Button */}
          <Pressable
            style={styles.backButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={22} color={colors.onSurface} />
          </Pressable>

          {/* Search Field */}
          <View style={styles.searchContainer}>
            <Feather name="search" size={20} color={colors.onSurfaceVariant} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search drop location"
              placeholderTextColor={colors.onSurfaceVariant}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <Pressable
                style={styles.clearButton}
                onPress={() => setSearchQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Feather name="x" size={20} color={colors.onSurfaceVariant} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Overlay centre marker: real map already renders pickup / drop
            markers, but the fixed centre pin makes it clear that panning the
            map picks the drop location. */}
        <View style={styles.mapPinContainer} pointerEvents="none">
          <View style={styles.mapPin}>
            <Feather name="map-pin" size={24} color={colors.onPrimary} />
          </View>
          <View style={styles.mapPinDot} />
        </View>
      </MapCanvas>

      {/* Bottom Information Panel */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSheet}>
        {/* Drag Handle */}
        <View style={styles.dragHandleWrapper}>
          <View style={styles.dragHandle} />
        </View>

        <View style={styles.sheetContent}>
          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.dropIndex}>{dropLabel}</Text>
            <Text style={styles.locationTitle} numberOfLines={2}>
              {selectedPlace?.address ?? 'No location selected'}
            </Text>
          </View>

          {/* Instructions Input */}
          <View style={styles.instructionsContainer}>
            <Feather name="edit-2" size={20} color={colors.onSurfaceVariant} style={styles.instructionsIcon} />
            <TextInput
              style={styles.instructionsInput}
              placeholder="Add Landmark / Instructions (Optional)"
              placeholderTextColor={colors.onSurfaceVariant}
              value={instructions}
              onChangeText={setInstructions}
            />
          </View>

          {/* Actions */}
          <View style={styles.actionsContainer}>
            <Pressable
              style={styles.addDropButton}
              onPress={() => (onAddAnother ? onAddAnother() : navigation?.navigate('MultiDropOverviewScreen'))}
              accessibilityRole="button"
            >
              <Feather name="plus" size={18} color={colors.primary} />
              <Text style={styles.addDropText}>Add another drop</Text>
            </Pressable>

            <Pressable
              style={styles.confirmButton}
              onPress={handleConfirm}
              disabled={!selectedPlace}
              accessibilityRole="button"
            >
              <Text style={styles.confirmText}>CONFIRM DROP</Text>
              <Feather name="check" size={18} color={colors.onPrimary} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  
  // Map Canvas
  mapCanvas: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  
  // Top Controls
  topControls: {
    flexDirection: 'row',
    paddingHorizontal: spacing.marginMobile,
    gap: spacing.md,
    zIndex: 10,
  },
  backButton: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.full,
    height: 48,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    fontFamily: typography.bodyMd.fontFamily,
    color: colors.onSurface,
    padding: 0, // Remove default padding
  },
  clearButton: {
    marginLeft: spacing.xs,
    padding: spacing.xs,
  },

  // Map Pin
  mapPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -20 }, { translateY: -40 }], // Center adjustment
    alignItems: 'center',
  },
  mapPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  mapPinDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 4,
    opacity: 0.8,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 40,
    right: spacing.marginMobile,
    width: 48,
    height: 48,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainerLowest,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
    zIndex: 10,
  },

  // Bottom Sheet
  bottomSheet: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: borderRadius.lg, // approx 16px
    borderTopRightRadius: borderRadius.lg,
    marginTop: -16, // overlap map
    ...shadows.elevated, // 0 -4px 24px rgba(0,0,0,0.06)
  },
  dragHandleWrapper: {
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: borderRadius.full,
    backgroundColor: colors.outlineVariant,
    opacity: 0.5,
  },
  sheetContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.marginMobile,
    paddingTop: spacing.xs,
    gap: spacing.xl,
  },

  // Header
  sheetHeader: {
    gap: 4,
  },
  dropIndex: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
  },
  locationTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },

  // Instructions Input
  instructionsContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  instructionsIcon: {
    position: 'absolute',
    left: spacing.md,
    zIndex: 1,
  },
  instructionsInput: {
    flex: 1,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.sm,
    paddingVertical: spacing.md,
    paddingLeft: 44, // space for icon
    paddingRight: spacing.md,
    fontSize: typography.bodyMd.fontSize,
    fontFamily: typography.bodyMd.fontFamily,
    color: colors.onSurface,
  },

  // Actions
  actionsContainer: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  addDropButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'center',
  },
  addDropText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
  },
  confirmText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600', // matches tracking-wide font-label-sm in uppercase
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});

export default SelectDropLocationScreen;
