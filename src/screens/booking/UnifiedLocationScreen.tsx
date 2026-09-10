import React, { useCallback, useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Dimensions,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { reverseGeocode, type ResolvedPlace } from '../../api/geocoding';
import type { GeoPoint } from '../../api/types';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useBooking } from '../../state/BookingContext';
import Button from '../../components/atoms/Button';
import DraggableBottomSheet from '../../components/organisms/DraggableBottomSheet';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export type LocationSelectionMode = 'pickup' | 'drop' | 'stop' | 'edit';

export interface UnifiedLocationScreenProps {
  readonly route?: {
    params?: {
      mode?: LocationSelectionMode;
      editTarget?: { type: 'pickup' | 'drop'; index?: number };
    };
  };
  readonly navigation?: any;
}

const UnifiedLocationScreen: React.FC<UnifiedLocationScreenProps> = ({ route, navigation }) => {
  const {
    draft,
    setPickup,
    setSender,
    addDrop,
    replaceDrop,
    setPendingDrop,
    commitPendingDrop,
  } = useBooking();

  const insets = useSafeAreaInsets();
  
  // High-level mode
  const initialMode = route?.params?.mode ?? 'pickup';
  const [mode, setMode] = useState<LocationSelectionMode>(initialMode);

  // If we're editing a specific target from the 'edit' mode list
  const [editTarget, setEditTarget] = useState<{ type: 'pickup' | 'drop'; index?: number } | undefined>(
    route?.params?.editTarget
  );

  // Determine what we're currently resolving/editing.
  const activeType = useMemo(() => {
    if (mode === 'edit' && !editTarget) return 'none'; // showing timeline
    if (editTarget) return editTarget.type;
    return mode === 'pickup' ? 'pickup' : 'drop';
  }, [mode, editTarget]);

  // Read initial place from context based on active type
  const initialPlace = useMemo<ResolvedPlace | undefined>(() => {
    if (activeType === 'pickup') {
      return draft.pickup;
    } else if (activeType === 'drop') {
      if (editTarget?.index !== undefined && editTarget.index < draft.drops.length) {
        return draft.drops[editTarget.index];
      }
      return draft.pendingDrop ?? draft.drops[draft.drops.length - 1];
    }
    return undefined;
  }, [activeType, draft.pickup, draft.drops, draft.pendingDrop, editTarget]);

  // Form State
  const [tempPlace, setTempPlace] = useState<ResolvedPlace | undefined>(initialPlace);
  const [searchQuery, setSearchQuery] = useState(initialPlace?.address ?? '');
  
  // Person fields
  const [instructions, setInstructions] = useState(
    activeType === 'pickup' ? (draft.pickupInstructions ?? '') : (initialPlace?.instructions ?? '')
  );
  
  const [personName, setPersonName] = useState(
    activeType === 'pickup' ? (draft.senderName ?? '') : (initialPlace?.receiverName ?? '')
  );
  
  const [personPhone, setPersonPhone] = useState(
    activeType === 'pickup' ? (draft.senderPhone ?? '') : (initialPlace?.receiverPhone ?? '')
  );

  const [isResolving, setIsResolving] = useState(false);

  // Re-sync form state when activeType or initialPlace changes (e.g. user tapped a timeline item)
  useEffect(() => {
    setTempPlace(initialPlace);
    setSearchQuery(initialPlace?.address ?? '');
    setInstructions(activeType === 'pickup' ? (draft.pickupInstructions ?? '') : (initialPlace?.instructions ?? ''));
    setPersonName(activeType === 'pickup' ? (draft.senderName ?? '') : (initialPlace?.receiverName ?? ''));
    setPersonPhone(activeType === 'pickup' ? (draft.senderPhone ?? '') : (initialPlace?.receiverPhone ?? ''));
  }, [activeType, initialPlace, draft.pickupInstructions, draft.senderName, draft.senderPhone]);

  // Map markers: if editing pickup, maybe show drops. If editing drop, definitely show pickup.
  const mapMarkers = useMemo<readonly MapMarker[]>(() => {
    const markers: MapMarker[] = [];
    if (activeType === 'drop' && draft.pickup) {
      markers.push({ id: 'pickup', kind: 'pickup', coordinate: draft.pickup, title: 'Pickup' });
    }
    if (activeType === 'pickup') {
      draft.drops.forEach((d, i) => {
        markers.push({ id: `drop-${i}`, kind: 'drop', coordinate: d, title: `Drop ${i+1}` });
      });
    }
    return markers;
  }, [activeType, draft.pickup, draft.drops]);

  const handleRegionChange = useCallback(
    (point: GeoPoint) => {
      // Don't resolve if we are just looking at the timeline
      if (mode === 'edit' && !editTarget) return;

      if (
        tempPlace &&
        Math.abs(tempPlace.latitude - point.latitude) < 0.0001 &&
        Math.abs(tempPlace.longitude - point.longitude) < 0.0001
      ) {
        return;
      }

      setIsResolving(true);
      void (async () => {
        let address = 'Dropped pin';
        try {
          const resolved = await reverseGeocode(point);
          if (resolved) address = resolved;
        } catch {}
        
        setSearchQuery(address);
        const newPlace = { ...tempPlace, ...point, address };
        setTempPlace(newPlace);
        setIsResolving(false);
      })();
    },
    [mode, editTarget, tempPlace]
  );

  const numericPhone = personPhone.replace(/\D/g, '');
  const isFormValid = personName.trim().length > 0 && numericPhone.length >= 10 && tempPlace;

  const handleConfirm = () => {
    if (!tempPlace) return;

    if (activeType === 'pickup') {
      setPickup(tempPlace);
      setSender({ name: personName, phone: personPhone, instructions });
    } else if (activeType === 'drop') {
      const dropObj = {
        ...tempPlace,
        receiverName: personName,
        receiverPhone: personPhone,
        instructions,
      };

      if (editTarget?.index !== undefined && editTarget.index < draft.drops.length) {
        // Editing an existing drop
        replaceDrop(editTarget.index, dropObj);
      } else {
        // Adding a new drop
        setPendingDrop(dropObj);
        commitPendingDrop();
      }
    }

    // Navigation logic after confirm
    if (mode === 'edit' && editTarget) {
      // Return to timeline view within the edit mode
      setEditTarget(undefined);
    } else if (mode === 'pickup') {
      // Normal flow: go to Drop
      navigation?.navigate('SelectDropLocationScreen');
    } else {
      // Drop, stop, or done editing timeline
      navigation?.navigate('SelectVehicleScreen');
    }
  };

  const handleAddAnother = () => {
    if (!tempPlace) return;
    
    // Save current as a new drop
    const dropObj = {
      ...tempPlace,
      receiverName: personName,
      receiverPhone: personPhone,
      instructions,
    };
    setPendingDrop(dropObj);
    commitPendingDrop();
    
    // Clear form for the next drop
    setTempPlace(undefined);
    setSearchQuery('');
    setPersonName('');
    setPersonPhone('');
    setInstructions('');
  };

  // ----------------------------------------------------------------------
  // Render Helpers
  // ----------------------------------------------------------------------

  const renderTopControls = () => (
    <View style={[styles.topControls, { paddingTop: Math.max(insets.top, spacing.marginMobile) }]}>
      <Pressable
        style={styles.backButton}
        onPress={() => {
          if (mode === 'edit' && editTarget) {
            setEditTarget(undefined); // Back to timeline
          } else {
            navigation?.goBack();
          }
        }}
      >
        <Feather name="arrow-left" size={22} color={colors.onSurface} />
      </Pressable>

      <View style={styles.searchContainer}>
        <Feather name="search" size={20} color={colors.onSurfaceVariant} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search location"
          placeholderTextColor={colors.onSurfaceVariant}
          value={searchQuery}
          onChangeText={setSearchQuery}
          editable={mode !== 'edit' || editTarget !== undefined}
        />
        {searchQuery.length > 0 && (
          <Pressable style={styles.clearButton} onPress={() => setSearchQuery('')}>
            <Feather name="x" size={20} color={colors.onSurfaceVariant} />
          </Pressable>
        )}
      </View>
    </View>
  );

  const renderForm = () => {
    let headerLabel = 'LOCATION';
    if (activeType === 'pickup') headerLabel = 'PICKUP';
    if (activeType === 'drop') {
      if (editTarget?.index !== undefined) {
        headerLabel = `DROP ${editTarget.index + 1}`;
      } else {
        headerLabel = `DROP ${draft.drops.length + 1}`;
      }
    }

    return (
      <View style={styles.sheetContent}>
        <View style={styles.sheetHeader}>
          <Text style={styles.dropIndex}>{headerLabel}</Text>
          <Text style={styles.locationTitle} numberOfLines={2}>
            {isResolving ? 'Locating…' : (tempPlace?.address ?? 'No location selected')}
          </Text>
        </View>

        <View style={styles.formContainer}>
          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.inputField}
              placeholder="House / Apartment / Shop (optional)"
              placeholderTextColor={colors.onSurfaceVariant}
              value={instructions}
              onChangeText={setInstructions}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>{activeType === 'pickup' ? "Sender's Name" : "Receiver's Name"}</Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.inputFieldInner}
                placeholder="Enter name"
                placeholderTextColor={colors.onSurfaceVariant}
                value={personName}
                onChangeText={setPersonName}
              />
              <MaterialIcons name="contact-page" size={20} color={colors.primary} />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <Text style={styles.inputLabel}>{activeType === 'pickup' ? "Sender's Mobile number" : "Receiver's Mobile number"}</Text>
            <TextInput
              style={styles.inputFieldInner}
              placeholder="Enter mobile number"
              placeholderTextColor={colors.onSurfaceVariant}
              value={personPhone}
              onChangeText={setPersonPhone}
              keyboardType="phone-pad"
              maxLength={10}
            />
          </View>
        </View>

        <View style={styles.actionsContainer}>
          <Button
            label={mode === 'edit' && editTarget ? "Save Changes" : "Confirm and Proceed"}
            onPress={handleConfirm}
            variant="primary"
            fullWidth
            disabled={isResolving || !isFormValid}
          />
          {activeType === 'drop' && !editTarget && (
            <Pressable
              style={styles.addDropButton}
              onPress={handleAddAnother}
              disabled={isResolving || !isFormValid}
            >
              <Feather name="plus" size={18} color={isResolving || !isFormValid ? colors.onSurfaceVariant : colors.primary} />
              <Text style={[styles.addDropText, (isResolving || !isFormValid) && { color: colors.onSurfaceVariant }]}>Add another drop</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  };

  const renderTimeline = () => {
    // Shows Pickup and all Drops so user can tap to edit them.
    return (
      <View style={styles.sheetContent}>
        <Text style={styles.timelineHeader}>Edit Route</Text>
        <View style={styles.timelineContainer}>
          <View style={styles.timelineLine} />
          
          {/* Pickup */}
          <View style={styles.stopRow}>
            <View style={styles.stopIconContainer}>
              <View style={[styles.stopIconInner, styles.stopIconPickup]}>
                <Feather name="circle" size={16} color={colors.primary} />
              </View>
            </View>
            <Pressable 
              style={styles.stopCard}
              onPress={() => setEditTarget({ type: 'pickup' })}
            >
              <View style={styles.stopCardContent}>
                <Text style={styles.stopLabel}>PICKUP</Text>
                <Text style={styles.stopTitle}>{draft.pickup?.address || 'Current Location'}</Text>
              </View>
              <Feather name="edit-2" size={18} color={colors.primary} style={{ alignSelf: 'center' }} />
            </Pressable>
          </View>

          {/* Drops */}
          {draft.drops.map((drop, index) => (
            <View key={`drop-${index}`} style={styles.stopRow}>
              <View style={styles.stopIconContainer}>
                <View style={[styles.stopIconInner, styles.stopIconDrop]}>
                  <Text style={styles.stopIndexText}>{index + 1}</Text>
                </View>
              </View>
              <Pressable 
                style={styles.stopCard}
                onPress={() => setEditTarget({ type: 'drop', index })}
              >
                <View style={styles.stopCardContent}>
                  <Text style={styles.stopLabel}>DROP {index + 1}</Text>
                  <Text style={styles.stopTitle}>{drop.address}</Text>
                </View>
                <Feather name="edit-2" size={18} color={colors.primary} style={{ alignSelf: 'center' }} />
              </Pressable>
            </View>
          ))}
          
        </View>
        <Button
          label="Done Editing"
          onPress={() => navigation?.goBack()}
          variant="primary"
          fullWidth
          style={{ marginTop: spacing.xl }}
        />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <MapCanvas
        style={styles.mapCanvas}
        center={tempPlace}
        markers={mapMarkers}
        showsUserLocation
        onRegionChangeComplete={handleRegionChange}
      >
        {renderTopControls()}

        {/* Map Center Pin - Only show if not just viewing timeline */}
        {(mode !== 'edit' || editTarget !== undefined) && (
          <View style={styles.mapPinContainer} pointerEvents="none">
            <View style={styles.mapPin}>
              <Feather name="map-pin" size={24} color={colors.onPrimary} />
            </View>
            <View style={styles.mapPinDot} />
          </View>
        )}
      </MapCanvas>

      <DraggableBottomSheet
        snapPoints={[200, SCREEN_HEIGHT * 0.65, SCREEN_HEIGHT * 0.85]}
        initialSnapIndex={1}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.scrollContent}
        >
          {mode === 'edit' && editTarget === undefined ? renderTimeline() : renderForm()}
        </ScrollView>
      </DraggableBottomSheet>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
  },
  mapCanvas: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
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
  searchIcon: { marginRight: spacing.sm },
  searchInput: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    fontFamily: typography.bodyMd.fontFamily,
    color: colors.onSurface,
    padding: 0,
  },
  clearButton: { marginLeft: spacing.xs, padding: spacing.xs },
  mapPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -20 }, { translateY: -40 }],
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
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  sheetContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.sm,
  },
  sheetHeader: { gap: 4, marginBottom: spacing.xl },
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
  formContainer: { gap: spacing.md, marginBottom: spacing.xl },
  inputWrapper: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 4,
  },
  inputField: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    paddingVertical: spacing.xs,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inputFieldInner: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    paddingVertical: spacing.xs,
  },
  actionsContainer: { gap: spacing.md, marginTop: spacing.xs },
  addDropButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'center',
    marginTop: spacing.md,
  },
  addDropText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  timelineHeader: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    marginBottom: spacing.xl,
  },
  timelineContainer: { position: 'relative' },
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
    borderColor: colors.surface,
  },
  stopIconPickup: { backgroundColor: colors.primaryFixed },
  stopIconDrop: { backgroundColor: colors.surfaceContainerHighest },
  stopIndexText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
  },
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
  stopCardContent: { flex: 1, gap: 4 },
  stopLabel: {
    fontSize: typography.labelCaps.fontSize,
    color: colors.outline,
    textTransform: 'uppercase',
  },
  stopTitle: {
    fontSize: typography.headlineSm.fontSize,
    color: colors.onSurface,
  },
});

export default UnifiedLocationScreen;
