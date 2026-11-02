import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  Keyboard,
  ActivityIndicator,
  Animated,
  BackHandler,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { getCurrentPlace, reverseGeocode, type ResolvedPlace, type PlaceSuggestion } from '../../api/geocoding';
import type { GeoPoint } from '../../api/types';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { useBooking } from '../../state/BookingContext';
import { useRecentLocations, saveRecentLocation } from '../../state/recentLocations';
import Button from '../../components/atoms/Button';
import { getAuth, onAuthStateChanged } from '@react-native-firebase/auth';
import { getSavedAddresses, saveAddress, updateSavedAddress } from '../../state/savedAddresses';
import { withAddressDetails } from '../../utils/locationDetails';
import { useFocusEffect } from '@react-navigation/native';
import { KeyboardAwareScrollView } from '../../components/organisms';
import { usePlaceSearch } from '../../hooks/usePlaceSearch';

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
    customerId,
  } = useBooking();

  const insets = useSafeAreaInsets();
  
  // High-level mode
  const initialMode = route?.params?.mode ?? 'pickup';
  const [detailsOpen, setDetailsOpen] = useState(false);
  const mapShare = useRef(new Animated.Value(0.62)).current;
  const [mapCenter, setMapCenter] = useState<GeoPoint | undefined>(draft.pickup);
  const [locationError, setLocationError] = useState<string>();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [mode, setMode] = useState<LocationSelectionMode>(initialMode);

  // If we're editing a specific target from the 'edit' mode list
  const [editTarget, setEditTarget] = useState<{ type: 'pickup' | 'drop'; index?: number } | undefined>(
    route?.params?.editTarget
  );

  // React Navigation can reuse this screen for a different stop.
  useEffect(() => {
    setDetailsOpen(false);
    setMode(route?.params?.mode ?? 'pickup');
    setEditTarget(route?.params?.editTarget);
  }, [route?.params?.mode, route?.params?.editTarget?.type, route?.params?.editTarget?.index]);

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
      return draft.pendingDrop ?? draft.pickup;
    }
    return undefined;
  }, [activeType, draft.pickup, draft.drops, draft.pendingDrop, editTarget]);

  // Form State
  const [tempPlace, setTempPlace] = useState<ResolvedPlace | undefined>(initialPlace);
  const [searchQuery, setSearchQuery] = useState(initialPlace?.address ?? '');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const { locations: recentLocations } = useRecentLocations(customerId);

  const {
    setQuery: setSearchQueryPlace,
    suggestions,
    isSearching: isPlaceSearching,
    resolve: resolvePlaceSuggestion,
    clear: clearPlaceSuggestions,
  } = usePlaceSearch(tempPlace);

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

  const [houseDetails, setHouseDetails] = useState(initialPlace?.addressDetails ?? '');
  const [saveAs, setSaveAs] = useState<'Home' | 'Shop' | 'Other' | undefined>();
  const [saveError, setSaveError] = useState<string>();
  const [savingDetails, setSavingDetails] = useState(false);
  const saveFlight = useRef(false);
  const previousPhone = useRef('');
  const [useOwnNumber, setUseOwnNumber] = useState(false);
  const [ownMobile, setOwnMobile] = useState('');
  useEffect(() => onAuthStateChanged(getAuth(), user => {
    const digits = user?.uid === customerId ? user?.phoneNumber?.replace(/\D/g, '') ?? '' : '';
    setOwnMobile(digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 10 ? digits : '');
    setUseOwnNumber(false);
  }), [customerId]);
  const [isResolving, setIsResolving] = useState(false);
  const latestResolveSeq = useRef(0);
  const searchRef = useRef<TextInput>(null);

  // Re-sync form state when activeType or initialPlace changes (e.g. user tapped a timeline item)
  useEffect(() => {
    setHouseDetails(initialPlace?.addressDetails ?? '');
    setSaveAs(undefined);
    setSaveError(undefined);
    setUseOwnNumber(false);
    setTempPlace(initialPlace);
    if (initialPlace) setMapCenter(initialPlace);
    setSearchQuery(initialPlace?.address ?? '');
    setInstructions(activeType === 'pickup' ? (draft.pickupInstructions ?? '') : (initialPlace?.instructions ?? ''));
    setPersonName(activeType === 'pickup' ? (draft.senderName ?? '') : (initialPlace?.receiverName ?? ''));
    setPersonPhone(activeType === 'pickup' ? (draft.senderPhone ?? '') : (initialPlace?.receiverPhone ?? ''));
  }, [activeType, initialPlace, draft.pickupInstructions, draft.senderName, draft.senderPhone]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardOpen(false));
    return () => { ++latestResolveSeq.current; show.remove(); hide.remove(); };
  }, []);
  // Android adjustResize already removes keyboard space from this viewport.
  // Its native ScrollView must not add a second keyboard-height spacer.
  const DetailsScrollView = Platform.OS === 'android' ? ScrollView : KeyboardAwareScrollView;
  const timelineVisible = mode === 'edit' && !editTarget;
  useEffect(() => {
    Animated.timing(mapShare, { toValue: keyboardOpen ? 0.3 : detailsOpen || timelineVisible ? 0.42 : 0.62, duration: 260, useNativeDriver: false }).start();
  }, [detailsOpen, timelineVisible, keyboardOpen, mapShare]);

  const collapseDetails = () => {
    Keyboard.dismiss();
    setDetailsOpen(false);
    if (tempPlace) setMapCenter(tempPlace);
  };
  useFocusEffect(useCallback(() => {
    if (!detailsOpen) return;
    const sub = BackHandler?.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      setDetailsOpen(false);
      return true;
    });
    return () => sub?.remove();
  }, [detailsOpen]));

  const selectLocation = () => {
    if (!tempPlace || isResolving) return;
    Keyboard.dismiss();
    setIsSearchFocused(false);
    clearPlaceSuggestions();
    setMapCenter(tempPlace);
    setDetailsOpen(true);
  };
  const locateSelection = async () => {
    const seq = ++latestResolveSeq.current;
    setIsResolving(true);
    setLocationError(undefined);
    try {
      const place = await getCurrentPlace();
      if (seq !== latestResolveSeq.current) return;
      setTempPlace(place);
      setMapCenter(place);
      setSearchQuery(place.address);
      setDetailsOpen(false);
      setIsSearchFocused(false);
      Keyboard.dismiss();
    } catch {
      if (seq === latestResolveSeq.current) setLocationError('Could not find your location. Move the map or search for an address.');
    } finally { if (seq === latestResolveSeq.current) setIsResolving(false); }
  };

  const handleSearchChange = (text: string) => {
    setSearchQuery(text);
    setSearchQueryPlace(text);
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    clearPlaceSuggestions();
  };

  const handleSelectSuggestion = async (s: PlaceSuggestion) => {
    const seq = ++latestResolveSeq.current;
    try {
      setIsResolving(true);
      const place = await resolvePlaceSuggestion(s);
      if (seq !== latestResolveSeq.current) return;
      setMapCenter(place);
      setTempPlace(place);
      setSearchQuery(place.address);
      clearPlaceSuggestions();
      setIsSearchFocused(false);
      Keyboard.dismiss();
      void saveRecentLocation(
        {
          name: s.primaryText,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          placeId: place.placeId || s.placeId,
        },
        customerId
      );
    } catch {
      // Ignore resolution failures and retain current place
    } finally {
      if (seq === latestResolveSeq.current) setIsResolving(false);
    }
  };

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
    (point: GeoPoint, details?: { isGesture?: boolean }) => {
      // Don't resolve if we are just looking at the timeline
      if (detailsOpen || (mode === 'edit' && !editTarget)) return;

      // DO NOT auto-fetch if it wasn't a user gesture!
      if (details && !details.isGesture) {
        return;
      }

      if (
        tempPlace &&
        Math.abs(tempPlace.latitude - point.latitude) < 0.0001 &&
        Math.abs(tempPlace.longitude - point.longitude) < 0.0001
      ) {
        return;
      }

      const seq = ++latestResolveSeq.current;
      setIsResolving(true);
      void (async () => {
        try {
          const resolved = await reverseGeocode(point);
          if (seq !== latestResolveSeq.current) return;

          const address = resolved && resolved.trim().length > 0
            ? resolved
            : `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;

          setSearchQuery(address);
          setTempPlace((prev) => ({
            ...(prev ?? {}),
            ...point,
            address,
          }));
        } catch {
          if (seq !== latestResolveSeq.current) return;
          const fallback = `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
          setSearchQuery(fallback);
          setTempPlace((prev) => ({
            ...(prev ?? {}),
            ...point,
            address: fallback,
          }));
        } finally {
          if (seq === latestResolveSeq.current) {
            setIsResolving(false);
          }
        }
      })();
    },
    [mode, editTarget, tempPlace, detailsOpen]
  );

  const numericPhone = personPhone.replace(/\D/g, '');
  const isFormValid = personName.trim().length > 0 && numericPhone.length >= 10 && tempPlace;

  const finishDetails = async (next: (place: ResolvedPlace) => void) => {
    if (!tempPlace || !isFormValid || isResolving || saveFlight.current) return;
    const owner = customerId;
    const identity = getAuth().currentUser?.uid;
    saveFlight.current = true;
    setSavingDetails(true);
    setSaveError(undefined);
    Keyboard.dismiss();
    const place = withAddressDetails(tempPlace, houseDetails);
    try {
      if (saveAs) {
        if (!owner || identity !== owner) throw new Error('Sign in again before saving this address.');
        const id = `location_${saveAs}_${place.latitude}_${place.longitude}`;
        const existing = await getSavedAddresses(owner);
        if (getAuth().currentUser?.uid !== identity) throw new Error('Your sign-in changed. Please try again.');
        const input = { id, title: saveAs, icon: saveAs === 'Home' ? 'home' as const : saveAs === 'Shop' ? 'box' as const : 'map-pin' as const,
          addressLine1: place.address, addressLine2: '', latitude: place.latitude, longitude: place.longitude };
        const result = existing.some(item => item.id === id)
          ? await updateSavedAddress(id, input, owner) : await saveAddress(input, owner);
        if (!result.some(item => item.id === id && item.addressLine1 === place.address)) throw new Error('Could not save this address. Please retry or deselect Save as.');
      }
      if (getAuth().currentUser?.uid !== identity) return;
      void saveRecentLocation({ name: tempPlace.address.split(',')[0].trim(), address: place.address,
        latitude: place.latitude, longitude: place.longitude, placeId: place.placeId }, owner);
      next(place);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save your details. Please try again.');
    } finally { saveFlight.current = false; setSavingDetails(false); }
  };

  const handleConfirm = () => finishDetails(place => {
    if (activeType === 'pickup') {
      setPickup(place);
      setSender({ name: personName.trim(), phone: numericPhone, instructions });
    } else if (activeType === 'drop') {
      const dropObj = {
        ...place,
        receiverName: personName,
        receiverPhone: numericPhone,
        instructions,
      };

      if (editTarget?.index !== undefined && editTarget.index < draft.drops.length) {
        // Editing an existing drop
        replaceDrop(editTarget.index, dropObj);
      } else {
        // Adding a new drop
        if (draft.drops.length >= 5) return;
        // This form now owns the saved stop. Returning from vehicle selection
        // edits that stop instead of creating another one.
        setEditTarget({ type: 'drop', index: draft.drops.length });
        addDrop(dropObj);
        setPendingDrop(undefined);
      }
    }

    // Navigation logic after confirm
    if (mode === 'edit' && editTarget) {
      // Saving an edit completes it; do not show another confirmation timeline.
      if (typeof navigation?.popTo === 'function') navigation.popTo('SelectVehicleScreen');
      else navigation?.navigate('SelectVehicleScreen');
    } else if (mode === 'pickup') {
      // Normal flow: go to Drop
      navigation?.navigate('SelectDropLocationScreen');
    } else {
      // Drop, stop, or done editing timeline
      navigation?.navigate('SelectVehicleScreen');
    }
  });

  // ----------------------------------------------------------------------
  // Render Helpers
  // ----------------------------------------------------------------------

  const renderTopControls = () => (
    <View style={styles.topControlsWrapper}>
      <View style={[styles.topControls, { paddingTop: Math.max(insets.top, spacing.marginMobile) }]}>
        <Pressable
          style={styles.backButton}
          onPress={() => {
            if (isSearchFocused) {
              setIsSearchFocused(false);
              clearPlaceSuggestions();
              Keyboard.dismiss();
              return;
            }
            if (detailsOpen) { collapseDetails(); return; }
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
            ref={searchRef}
            style={styles.searchInput}
            placeholder="Search location"
            placeholderTextColor={colors.onSurfaceVariant}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onFocus={() => setIsSearchFocused(true)}
            editable={mode !== 'edit' || editTarget !== undefined}
            returnKeyType="search"
          />
          {isPlaceSearching && (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: spacing.xs }} />
          )}
          {searchQuery.length > 0 && !isPlaceSearching && (
            <Pressable style={styles.clearButton} onPress={handleSearchClear}>
              <Feather name="x" size={20} color={colors.onSurfaceVariant} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Floating Autocomplete Suggestions Overlay */}
      {isSearchFocused && suggestions.length > 0 && (
        <View style={styles.suggestionsContainer}>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            nestedScrollEnabled
            showsVerticalScrollIndicator={false}
            style={styles.suggestionsScroll}
          >
            {suggestions.map((s) => (
              <Pressable
                key={s.placeId}
                style={styles.suggestionItem}
                onPress={() => handleSelectSuggestion(s)}
              >
                <View style={styles.suggestionIconWrapper}>
                  <Feather name="map-pin" size={16} color={colors.primary} />
                </View>
                <View style={styles.suggestionTextWrapper}>
                  <Text style={styles.suggestionPrimary} numberOfLines={1}>{s.primaryText}</Text>
                  {s.secondaryText.length > 0 && (
                    <Text style={styles.suggestionSecondary} numberOfLines={1}>{s.secondaryText}</Text>
                  )}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );

  const renderAddress = () => (
    <View style={styles.selectedAddress}>
      <View style={[styles.addressIcon, activeType === 'pickup' ? styles.pickupAccent : styles.dropAccent]}><Feather name="map-pin" size={spacing.xl} color={colors.white} /></View>
      <View style={styles.addressText}>
        <Text style={styles.addressEyebrow}>SELECTED {activeType === 'pickup' ? 'PICKUP' : 'DROP'}</Text>
        <Text style={styles.addressName} numberOfLines={1}>{tempPlace?.address.split(',')[0]?.trim() || 'Choose a location'}</Text>
        <Text style={styles.addressSubtitle} numberOfLines={2}>{isResolving ? 'Finding address...' : tempPlace?.address.split(',').slice(1).join(',').trim() || 'Move the map or search above'}</Text>
      </View>
      <Pressable style={styles.addressChange} onPress={collapseDetails} accessibilityRole="button" accessibilityLabel="Change selected location" hitSlop={spacing.sm}>
        <Text style={styles.changeText}>Change</Text>
      </Pressable>
    </View>
  );
  const renderSelection = () => (
    <View style={styles.sheetContent}>
      <Text style={styles.stageTitle}>Select {activeType === 'pickup' ? 'pickup' : 'drop'} location</Text>
      {renderAddress()}
      <Text style={styles.selectionHint}>Drag the map to place the pin exactly where you need it.</Text>
      {locationError && <Text style={styles.locationError}>{locationError}</Text>}
    </View>
  );
  const renderForm = () => (
    <View style={styles.sheetContent}>
      <View style={styles.detailsHeading}>
        <Text style={styles.stageTitle}>{activeType === 'pickup' ? 'Sender' : 'Receiver'} details</Text>
        <Pressable onPress={collapseDetails} accessibilityRole="button" accessibilityLabel="Back to location selection" hitSlop={spacing.sm}><Feather name="chevron-down" size={spacing.xxl} color={colors.primary} /></Pressable>
      </View>
      {renderAddress()}
      <View style={styles.formContainer}>
        <TextInput accessibilityLabel="House / Apartment / Shop (optional)" style={styles.filledInput} placeholder="House / Apartment / Shop (optional)" placeholderTextColor={colors.onSurfaceVariant} value={houseDetails} onChangeText={setHouseDetails} />
        <View style={styles.filledNameRow}>
          <TextInput accessibilityLabel={activeType === 'pickup' ? 'Sender name' : 'Receiver name'} style={styles.filledNameInput} placeholder={activeType === 'pickup' ? "Sender's Name" : "Receiver's Name"} placeholderTextColor={colors.onSurfaceVariant} value={personName} onChangeText={setPersonName} autoCapitalize="words" />
          <MaterialIcons name="person" size={spacing.xl} color={colors.primary} accessibilityElementsHidden importantForAccessibility="no" />
        </View>
        <TextInput accessibilityLabel="Mobile number" style={styles.filledInput} placeholder={activeType === 'pickup' ? "Sender's Mobile number" : "Receiver's Mobile number"} placeholderTextColor={colors.onSurfaceVariant} value={personPhone} onChangeText={text => { setUseOwnNumber(false); setPersonPhone(text.replace(/\D/g, '').slice(0, 10)); }} keyboardType="phone-pad" maxLength={10} />
        {ownMobile.length === 10 && <Pressable accessibilityRole="checkbox" accessibilityLabel="Use my mobile number" accessibilityState={{ checked: useOwnNumber }} style={styles.ownPhoneRow} onPress={() => {
          if (useOwnNumber) { setPersonPhone(previousPhone.current); setUseOwnNumber(false); }
          else { previousPhone.current = personPhone; setPersonPhone(ownMobile); setUseOwnNumber(true); }
        }}><Feather name={useOwnNumber ? 'check-square' : 'square'} size={spacing.xl} color={colors.primary} /><Text style={styles.ownPhoneText}>Use my mobile number: {ownMobile}</Text></Pressable>}
        <TextInput accessibilityLabel="Instructions (optional)" style={styles.filledInput} placeholder="Landmark / instructions (optional)" placeholderTextColor={colors.onSurfaceVariant} value={instructions} onChangeText={setInstructions} />
        <Text style={styles.saveAsLabel}>Save as (optional)</Text>
        <View style={styles.saveAsRow}>{(['Home', 'Shop', 'Other'] as const).map(label => <Pressable key={label} accessibilityRole="button" accessibilityLabel={`Save address as ${label}`} accessibilityState={{ selected: saveAs === label }} style={[styles.saveAsChip, saveAs === label && styles.saveAsSelected]} onPress={() => setSaveAs(saveAs === label ? undefined : label)}>
          <Feather name={label === 'Home' ? 'home' : label === 'Shop' ? 'shopping-bag' : 'heart'} size={spacing.lg} color={colors.primary} /><Text style={styles.changeText}>{label}</Text>
        </Pressable>)}</View>
        {saveAs && <Text style={styles.selectionHint}>Saved on this device for your account.</Text>}
      </View>
      {saveError && <Text style={styles.locationError}>{saveError}</Text>}
    </View>
  );

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
                <Text style={styles.stopTitle}>{draft.pickup?.address || 'Pickup location'}</Text>
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
            {draft.drops.length < 5 && (
              <Pressable
                style={styles.addDropButton}
                onPress={() => setEditTarget({ type: 'drop', index: draft.drops.length })}
              >
                <Feather name="plus" size={20} color={colors.primary} />
                <Text style={styles.addDropText}>Add Drop</Text>
              </Pressable>
            )}
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
      <Animated.View style={{ flex: mapShare, minHeight: spacing.rowHeightStandard * 2 }}>
        <MapCanvas style={styles.mapCanvas} appearance="home" center={mapCenter ?? tempPlace} markers={timelineVisible ? mapMarkers : []} scrollEnabled={!detailsOpen && !timelineVisible} onRegionChangeComplete={handleRegionChange}>
          {renderTopControls()}
          {!timelineVisible && <View style={styles.mapPinContainer} pointerEvents="none">
            <View style={styles.mapPointerRing}><View style={[styles.mapPointerCore, activeType === 'pickup' ? styles.pickupAccent : styles.dropAccent]} /></View>
            <View style={[styles.mapPointerStem, activeType === 'pickup' ? styles.pickupAccent : styles.dropAccent]} />
            <View style={[styles.mapPointerTip, activeType === 'pickup' ? styles.pickupAccent : styles.dropAccent]} />
          </View>}
          <Pressable style={styles.recenterButton} onPress={locateSelection} disabled={isResolving} accessibilityRole="button" accessibilityLabel="Use my current location">
            <Feather name="crosshair" size={spacing.xl} color={colors.primary} />
          </Pressable>
        </MapCanvas>
      </Animated.View>
      <Animated.View style={[styles.detailsSheet, { flex: Animated.subtract(1, mapShare), paddingBottom: keyboardOpen ? spacing.xs : Math.max(insets.bottom, spacing.sm) }]}>
        <View style={styles.sheetHandle} />
        <DetailsScrollView testID="location-details-scroll" style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" overScrollMode="never" bounces={false} automaticallyAdjustKeyboardInsets={false} contentContainerStyle={styles.scrollContent}>
          {timelineVisible ? renderTimeline() : detailsOpen ? renderForm() : renderSelection()}
        </DetailsScrollView>
        {!timelineVisible && <View style={styles.stickyFooter}>{detailsOpen
          ? <Button label="Save and continue" onPress={handleConfirm} fullWidth disabled={isResolving || !isFormValid || savingDetails} loading={savingDetails} style={styles.stageButton} />
          : <Button label={`Confirm ${activeType === 'pickup' ? 'pickup' : 'drop'} location`} onPress={selectLocation} disabled={!tempPlace || isResolving} loading={isResolving} fullWidth style={styles.stageButton} />}</View>}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  stickyFooter: { paddingHorizontal: spacing.marginMobile, paddingTop: spacing.sm, paddingBottom: spacing.sm, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.outlineHairline },
  filledInput: { ...typography.bodyMd, color: colors.onSurface, backgroundColor: colors.surfaceContainerLow, borderRadius: borderRadius.md, padding: spacing.md, minHeight: spacing.rowHeightSm + spacing.sm },
  filledNameRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceContainerLow, borderRadius: borderRadius.md, paddingHorizontal: spacing.md },
  filledNameInput: { ...typography.bodyMd, color: colors.onSurface, flex: 1, minWidth: 0, minHeight: spacing.rowHeightSm + spacing.sm, paddingVertical: spacing.md },
  ownPhoneRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', minHeight: spacing.rowHeightSm },
  ownPhoneText: { ...typography.labelSm, color: colors.primary, flex: 1 },
  saveAsLabel: { ...typography.bodyMd, color: colors.primary, fontWeight: '500' },
  saveAsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  saveAsChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.full, paddingHorizontal: spacing.md, minHeight: spacing.rowHeightSm },
  saveAsSelected: { backgroundColor: colors.primaryFixed, borderColor: colors.primary },
  detailsSheet: { flex: 1, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl, backgroundColor: colors.surface, overflow: 'hidden', paddingBottom: spacing.sm },
  sheetHandle: { width: spacing.xxxl, height: spacing.xs, backgroundColor: colors.outlineVariant, borderRadius: borderRadius.full, alignSelf: 'center', marginTop: spacing.sm },
  stageTitle: { ...typography.headlineMd, fontWeight: '700', color: colors.homeAction, marginBottom: spacing.md },
  selectedAddress: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.selectionOutline, borderRadius: borderRadius.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginBottom: spacing.md, ...shadows.card },
  addressIcon: { width: spacing.xxxl, height: spacing.xxxl, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center' },
  pickupAccent: { backgroundColor: colors.homePickup },
  dropAccent: { backgroundColor: colors.error },
  addressText: { flex: 1, minWidth: 0 },
  addressEyebrow: { ...typography.labelSm, fontSize: typography.labelSm.fontSize - 2, fontWeight: '700', color: colors.secondary, marginBottom: spacing.xs },
  addressName: { ...typography.bodyMd, fontWeight: '700', color: colors.homeAction },
  addressSubtitle: { ...typography.labelSm, color: colors.onSurfaceVariant, marginTop: spacing.xs },
  addressChange: { minHeight: spacing.rowHeightSm, justifyContent: 'center', paddingHorizontal: spacing.xs },
  selectionHint: { ...typography.labelSm, color: colors.secondary, marginBottom: spacing.sm },
  locationError: { ...typography.labelSm, color: colors.error, marginBottom: spacing.sm },
  stageButton: { backgroundColor: colors.homeAction, borderRadius: borderRadius.lg },
  detailsHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeText: { ...typography.labelSm, fontWeight: '600', color: colors.primary },
  detailInput: { ...typography.bodyMd, color: colors.onSurface, borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: spacing.rowHeightSm + spacing.xs },
  phoneField: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.md },
  phonePrefix: { ...typography.bodyMd, color: colors.primary, paddingHorizontal: spacing.md },
  phoneInput: { ...typography.bodyMd, color: colors.onSurface, flex: 1, minWidth: 0, minHeight: spacing.rowHeightSm + spacing.xs, padding: spacing.sm },
  recenterButton: { position: 'absolute', bottom: spacing.lg, right: spacing.lg, width: spacing.rowHeightSm + spacing.xs, height: spacing.rowHeightSm + spacing.xs, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, ...shadows.card },
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
    transform: [{ translateX: -spacing.xl }, { translateY: -(spacing.xl * 2 + spacing.md) }],
    alignItems: 'center',
  },
  mapPointerRing: { width: spacing.xl * 2, height: spacing.xl * 2, borderRadius: borderRadius.full, backgroundColor: colors.white, borderWidth: 2, borderColor: colors.outlineHairline, alignItems: 'center', justifyContent: 'center', ...shadows.elevated },
  mapPointerCore: { width: spacing.lg, height: spacing.lg, borderRadius: borderRadius.full },
  mapPointerStem: { width: 2, height: spacing.sm },
  mapPointerTip: { width: spacing.xs, height: spacing.xs, borderRadius: borderRadius.full },
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
    width: spacing.xs,
    height: spacing.xs,
    borderRadius: borderRadius.xs,
    backgroundColor: colors.primary,
    marginTop: 0,
    opacity: 0.8,
  },
  scrollContent: {
    paddingBottom: spacing.lg,
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
  topControlsWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  suggestionsContainer: {
    marginHorizontal: spacing.marginMobile,
    marginTop: spacing.xs,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.lg,
    maxHeight: 220,
    ...shadows.elevated,
    overflow: 'hidden',
  },
  suggestionsScroll: {
    maxHeight: 220,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant + '33',
    gap: spacing.sm,
  },
  suggestionIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionTextWrapper: {
    flex: 1,
  },
  suggestionPrimary: {
    fontSize: typography.bodyMd.fontSize,
    fontFamily: typography.bodyMd.fontFamily,
    fontWeight: '600',
    color: colors.onSurface,
  },
  suggestionSecondary: {
    fontSize: typography.labelSm.fontSize,
    fontFamily: typography.labelSm.fontFamily,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
});

export default UnifiedLocationScreen;
