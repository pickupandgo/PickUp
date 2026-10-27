import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import {
  useSavedAddresses,
  type SavedAddress,
  type SavedAddressIcon,
  DEFAULT_SAVED_ADDRESSES,
} from '../../state/savedAddresses';
import { useBooking } from '../../state/BookingContext';
import { getCurrentPlace, reverseGeocode } from '../../api/geocoding';
import { SavedAddressesSkeleton, useSkeletonVisibility } from '../../components/skeleton';
import MapCanvas, { FALLBACK_CENTER } from '../../components/map/MapCanvas';
import type { GeoPoint } from '../../api/types';

/**
 * Splits a reverse-geocoded or GPS address string cleanly into two lines:
 * - Line 1: House / Building / Street (with any leading Google Plus Code stripped)
 * - Line 2: Landmark / Area / City / Pincode
 */
export function splitAddressLines(rawAddress: string): { line1: string; line2: string } {
  if (!rawAddress || !rawAddress.trim()) {
    return { line1: '', line2: '' };
  }

  // Strip leading Google Plus Code e.g. "6XCC+CW5, " or "8V6W+9Q, "
  const cleaned = rawAddress.replace(/^[A-Z0-9]{4,8}\+[A-Z0-9]{2,4},\s*/i, '').trim();
  const addressToSplit = cleaned || rawAddress.trim();
  const parts = addressToSplit
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return { line1: rawAddress.trim(), line2: '' };
  }
  if (parts.length === 1) {
    return { line1: parts[0], line2: '' };
  }
  if (parts.length === 2) {
    return { line1: parts[0], line2: parts[1] };
  }

  const line1 = parts.slice(0, 2).join(', ');
  const line2 = parts.slice(2).join(', ');
  return { line1, line2 };
}

export type { SavedAddress };

export interface SavedAddressesScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  readonly onEditAddress?: (addressId: string) => void;
  readonly onDeleteAddress?: (addressId: string) => void;
  readonly onAddAddress?: () => void;
}

interface TagOption {
  label: string;
  icon: SavedAddressIcon;
  defaultTitle: string;
}

const TAG_OPTIONS: readonly TagOption[] = [
  { label: 'Home', icon: 'home', defaultTitle: 'Home' },
  { label: 'Office', icon: 'briefcase', defaultTitle: 'Office' },
  { label: 'Warehouse', icon: 'box', defaultTitle: 'Warehouse' },
  { label: 'Other', icon: 'map-pin', defaultTitle: 'Other' },
];

const SavedAddressesScreen: React.FC<SavedAddressesScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  onEditAddress,
  onDeleteAddress,
  onAddAddress,
  navigation,
}) => {
  const { customerId } = useBooking();
  const {
    addresses,
    isLoading,
    addAddress,
    updateAddress,
    removeAddress,
    setPrimary,
  } = useSavedAddresses(customerId);

  const showSkeleton = useSkeletonVisibility({
    isLoading,
    hasData: addresses.length > 0,
  });

  // Form Modal State
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingAddress, setEditingAddress] = useState<SavedAddress | null>(null);

  // Form Fields State
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState<SavedAddressIcon>('home');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [coordinates, setCoordinates] = useState<{ latitude?: number; longitude?: number }>({});
  const [isPrimary, setIsPrimary] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Map Picker State
  const [isMapPickerVisible, setIsMapPickerVisible] = useState(false);
  const [initialMapCenter, setInitialMapCenter] = useState<GeoPoint>(FALLBACK_CENTER);
  const [mapAddress, setMapAddress] = useState('');
  const [isGeocodingMap, setIsGeocodingMap] = useState(false);
  const [mapForceCenterKey, setMapForceCenterKey] = useState(1);

  // Pinned location tracking refs to avoid render and camera animation loops
  const pinnedPointRef = useRef<GeoPoint>(FALLBACK_CENTER);
  const lastGeocodedPointRef = useRef<GeoPoint | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveSeqRef = useRef<number>(0);

  // Clear debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  /** Opens modal to add a brand new address */
  const handleOpenAddModal = useCallback(() => {
    setEditingAddress(null);
    setTitle('Home');
    setIcon('home');
    setAddressLine1('');
    setAddressLine2('');
    setCoordinates({});
    setIsPrimary(addresses.length === 0);
    setFormError(null);
    setIsModalVisible(true);
    onAddAddress?.();
  }, [addresses.length, onAddAddress]);

  /** Opens modal to edit an existing address */
  const handleOpenEditModal = useCallback(
    (address: SavedAddress) => {
      setEditingAddress(address);
      setTitle(address.title);
      setIcon(address.icon);
      setAddressLine1(address.addressLine1);
      setAddressLine2(address.addressLine2);
      setCoordinates({ latitude: address.latitude, longitude: address.longitude });
      setIsPrimary(Boolean(address.isPrimary));
      setFormError(null);
      setIsModalVisible(true);
      onEditAddress?.(address.id);
    },
    [onEditAddress]
  );

  /** Handles deleting an address with user confirmation */
  const handleDeletePress = useCallback(
    (address: SavedAddress) => {
      const executeDelete = async () => {
        onDeleteAddress?.(address.id);
        await removeAddress(address.id);
      };

      Alert.alert(
        'Delete Address',
        `Are you sure you want to delete "${address.title}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              void executeDelete();
            },
          },
        ]
      );
    },
    [onDeleteAddress, removeAddress]
  );

  /** Auto-fills address lines from device location */
  const handleUseCurrentLocation = useCallback(async () => {
    setIsLocating(true);
    setFormError(null);
    try {
      const place = await getCurrentPlace();
      if (place && place.address) {
        setCoordinates({ latitude: place.latitude, longitude: place.longitude });
        const { line1, line2 } = splitAddressLines(place.address);
        setAddressLine1(line1);
        if (line2) {
          setAddressLine2(line2);
        }
      }
    } catch (err: any) {
      setFormError(err?.message || 'Could not fetch current location');
    } finally {
      setIsLocating(false);
    }
  }, []);

  /** Opens the interactive Map Location Picker */
  const handleOpenMapPicker = useCallback(async () => {
    setIsMapPickerVisible(true);
    setIsGeocodingMap(true);

    let startPoint: GeoPoint = FALLBACK_CENTER;
    if (coordinates.latitude && coordinates.longitude) {
      startPoint = { latitude: coordinates.latitude, longitude: coordinates.longitude };
    } else if (editingAddress?.latitude && editingAddress?.longitude) {
      startPoint = { latitude: editingAddress.latitude, longitude: editingAddress.longitude };
    }

    pinnedPointRef.current = startPoint;
    lastGeocodedPointRef.current = startPoint;
    setInitialMapCenter(startPoint);
    setMapForceCenterKey((prev) => prev + 1);

    try {
      if (!coordinates.latitude) {
        const place = await getCurrentPlace().catch(() => null);
        if (place) {
          startPoint = { latitude: place.latitude, longitude: place.longitude };
          pinnedPointRef.current = startPoint;
          lastGeocodedPointRef.current = startPoint;
          setInitialMapCenter(startPoint);
          setMapAddress(place.address || '');
          setIsGeocodingMap(false);
          setMapForceCenterKey((prev) => prev + 1);
          return;
        }
      }
      const addr = await reverseGeocode(startPoint);
      setMapAddress(addr);
    } catch {
      setMapAddress(`${startPoint.latitude.toFixed(5)}, ${startPoint.longitude.toFixed(5)}`);
    } finally {
      setIsGeocodingMap(false);
    }
  }, [coordinates, editingAddress]);

  /** Called when user finishes panning/moving the map */
  const handleMapRegionChange = useCallback(
    (point: GeoPoint, details?: { isGesture?: boolean }) => {
      // Ignore programmatic map adjustments (only react to user pan gestures)
      if (details && !details.isGesture) {
        return;
      }

      // Ignore trivial jitter (< ~10 meters)
      if (
        lastGeocodedPointRef.current &&
        Math.abs(lastGeocodedPointRef.current.latitude - point.latitude) < 0.0001 &&
        Math.abs(lastGeocodedPointRef.current.longitude - point.longitude) < 0.0001
      ) {
        return;
      }

      pinnedPointRef.current = point;

      // Debounce reverse geocoding to avoid spamming while dragging
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      const seq = ++resolveSeqRef.current;
      setIsGeocodingMap(true);

      debounceTimerRef.current = setTimeout(async () => {
        try {
          const resolved = await reverseGeocode(point);
          if (seq === resolveSeqRef.current) {
            lastGeocodedPointRef.current = point;
            setMapAddress(resolved);
          }
        } catch {
          if (seq === resolveSeqRef.current) {
            setMapAddress(`${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`);
          }
        } finally {
          if (seq === resolveSeqRef.current) {
            setIsGeocodingMap(false);
          }
        }
      }, 300);
    },
    []
  );

  /** Center map on current GPS location */
  const handleCenterOnMyLocation = useCallback(async () => {
    try {
      setIsGeocodingMap(true);
      const place = await getCurrentPlace();
      if (place) {
        const point = { latitude: place.latitude, longitude: place.longitude };
        pinnedPointRef.current = point;
        lastGeocodedPointRef.current = point;
        setInitialMapCenter(point);
        setMapAddress(place.address);
        setMapForceCenterKey((prev) => prev + 1);
      }
    } catch {
      // Ignore location error
    } finally {
      setIsGeocodingMap(false);
    }
  }, []);

  /** Confirms the pinned location from the map and fills the address inputs */
  const handleConfirmMapLocation = useCallback(() => {
    const finalPoint = pinnedPointRef.current || initialMapCenter;
    setCoordinates({ latitude: finalPoint.latitude, longitude: finalPoint.longitude });
    if (mapAddress) {
      const { line1, line2 } = splitAddressLines(mapAddress);
      setAddressLine1(line1);
      if (line2) {
        setAddressLine2(line2);
      }
    }
    setIsMapPickerVisible(false);
  }, [mapAddress, initialMapCenter]);

  /** Handles saving address (new or existing) */
  const handleSave = useCallback(async () => {
    if (!title.trim()) {
      setFormError('Please enter an address title (e.g. Home, Office)');
      return;
    }
    if (!addressLine1.trim()) {
      setFormError('Please enter the street / building address');
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      if (editingAddress) {
        await updateAddress(editingAddress.id, {
          title: title.trim(),
          icon,
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim(),
          latitude: coordinates.latitude ?? editingAddress.latitude,
          longitude: coordinates.longitude ?? editingAddress.longitude,
          isPrimary,
        });
      } else {
        await addAddress({
          title: title.trim(),
          icon,
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim(),
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          isPrimary,
        });
      }
      setIsModalVisible(false);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save address');
    } finally {
      setIsSaving(false);
    }
  }, [
    title,
    addressLine1,
    addressLine2,
    icon,
    isPrimary,
    coordinates,
    editingAddress,
    updateAddress,
    addAddress,
  ]);

  /** Selects a tag and updates title if untouched */
  const handleSelectTag = useCallback(
    (tag: TagOption) => {
      setIcon(tag.icon);
      if (!title || TAG_OPTIONS.some((t) => t.defaultTitle === title)) {
        setTitle(tag.defaultTitle);
      }
    },
    [title]
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable
            testID="saved-addresses-back-button"
            style={styles.iconButton}
            onPress={() => (onBack ? onBack() : navigation?.goBack())}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Feather name="arrow-left" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>Saved Addresses</Text>
        </View>
        <Pressable
          testID="saved-addresses-help-button"
          style={styles.iconButton}
          onPress={() =>
            onHelp
              ? onHelp()
              : navigation?.navigate('ActiveTripStack', { screen: 'ActiveTripChatScreen' })
          }
          accessibilityRole="button"
          accessibilityLabel="Help"
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      {/* Main Content List */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {showSkeleton ? (
          <SavedAddressesSkeleton testID="saved-addresses-loading" />
        ) : addresses.length === 0 ? (
          <View style={styles.emptyContainer} testID="saved-addresses-empty-state">
            <View style={styles.emptyIconBadge}>
              <Feather name="map-pin" size={32} color={colors.onSurfaceVariant} />
            </View>
            <Text style={styles.emptyTitle}>No Saved Addresses</Text>
            <Text style={styles.emptySubtitle}>
              Save your frequent destinations like Home, Office, or Warehouse for faster 1-tap bookings.
            </Text>
            <Pressable
              testID="empty-state-add-button"
              style={styles.emptyAddButton}
              onPress={handleOpenAddModal}
            >
              <Feather name="plus" size={18} color={colors.onPrimary} />
              <Text style={styles.emptyAddButtonText}>Add Address</Text>
            </Pressable>
          </View>
        ) : (
          addresses.map((address) => (
            <View
              key={address.id}
              testID={`address-card-${address.id}`}
              style={styles.card}
            >
              {address.isPrimary && <View style={styles.primaryAccentLine} />}

              <View style={styles.cardHeader}>
                <View style={styles.cardHeaderLeft}>
                  <View
                    style={[
                      styles.iconContainer,
                      address.isPrimary && styles.iconContainerPrimary,
                    ]}
                  >
                    <Feather
                      name={address.icon || 'map-pin'}
                      size={20}
                      color={
                        address.isPrimary
                          ? colors.onSecondaryContainer
                          : colors.onSurfaceVariant
                      }
                    />
                  </View>
                  <View>
                    <Text style={styles.cardTitle}>{address.title}</Text>
                    {address.isPrimary && (
                      <Text style={styles.primaryBadge}>PRIMARY</Text>
                    )}
                  </View>
                </View>

                <View style={styles.cardActions}>
                  <Pressable
                    testID={`edit-address-${address.id}`}
                    style={styles.actionButton}
                    onPress={() => handleOpenEditModal(address)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${address.title}`}
                  >
                    <Feather name="edit-2" size={20} color={colors.onSurfaceVariant} />
                  </Pressable>
                  <Pressable
                    testID={`delete-address-${address.id}`}
                    style={styles.actionButton}
                    onPress={() => handleDeletePress(address)}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${address.title}`}
                  >
                    <Feather name="trash-2" size={20} color={colors.onSurfaceVariant} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.addressBody}>
                <Text style={styles.addressLine1}>{address.addressLine1}</Text>
                {address.addressLine2 ? (
                  <View style={styles.addressLine2Row}>
                    <Feather
                      name="map-pin"
                      size={16}
                      color={colors.onSurfaceVariant}
                      style={styles.pinIcon}
                    />
                    <Text style={styles.addressLine2}>{address.addressLine2}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ))
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Fixed Bottom Action Area */}
      <View style={styles.bottomActionArea}>
        <Pressable
          testID="add-new-address-button"
          style={styles.addButton}
          onPress={handleOpenAddModal}
          accessibilityRole="button"
          accessibilityLabel="Add New Address"
        >
          <Feather name="plus" size={22} color={colors.onPrimary} />
          <Text style={styles.addButtonText}>Add New Address</Text>
        </Pressable>
      </View>

      {/* Add / Edit Address Modal */}
      <Modal
        testID="address-modal"
        visible={isModalVisible}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setIsModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <Pressable
            testID="address-modal-backdrop"
            style={styles.modalBackdrop}
            onPress={() => setIsModalVisible(false)}
            accessibilityRole="button"
            accessibilityLabel="Close dialog"
          />

          <View style={styles.modalSheet} testID="address-modal-sheet">
            <View style={styles.dragHandleContainer}>
              <View style={styles.dragHandle} />
            </View>

            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>
                {editingAddress ? 'Edit Address' : 'Add New Address'}
              </Text>
              <Pressable
                testID="address-modal-close-button"
                style={styles.modalCloseButton}
                onPress={() => setIsModalVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Feather name="x" size={22} color={colors.onSurfaceVariant} />
              </Pressable>
            </View>

            <ScrollView
              style={styles.modalFormScroll}
              contentContainerStyle={styles.modalFormContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Category / Tag Selection - Horizontally Scrollable */}
              <Text style={styles.inputLabel}>Select Tag</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.tagChipsScrollView}
                contentContainerStyle={styles.tagChipsContainer}
                keyboardShouldPersistTaps="handled"
              >
                {TAG_OPTIONS.map((tag) => {
                  const isSelected = icon === tag.icon;
                  return (
                    <Pressable
                      key={tag.label}
                      testID={`tag-chip-${tag.label.toLowerCase()}`}
                      style={[
                        styles.tagChip,
                        isSelected && styles.tagChipSelected,
                      ]}
                      onPress={() => handleSelectTag(tag)}
                    >
                      <Feather
                        name={tag.icon}
                        size={16}
                        color={isSelected ? colors.onPrimary : colors.onSurfaceVariant}
                      />
                      <Text
                        style={[
                          styles.tagChipText,
                          isSelected && styles.tagChipTextSelected,
                        ]}
                      >
                        {tag.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {/* Address Title */}
              <Text style={styles.inputLabel}>Address Title *</Text>
              <TextInput
                testID="address-title-input"
                style={styles.textInput}
                placeholder="e.g. Home, Office, Warehouse B"
                placeholderTextColor={colors.outline}
                value={title}
                onChangeText={(val) => {
                  setTitle(val);
                  if (formError) setFormError(null);
                }}
              />

              {/* Quick Location Action Buttons (Select on Map & Current Location) */}
              <View style={styles.quickLocationBar}>
                <Pressable
                  testID="select-on-map-button"
                  style={styles.quickLocationButton}
                  onPress={handleOpenMapPicker}
                  accessibilityRole="button"
                  accessibilityLabel="Select on Map"
                >
                  <Feather name="map" size={15} color={colors.primary} />
                  <Text style={styles.quickLocationButtonText}>Select on Map</Text>
                </Pressable>

                <Pressable
                  testID="use-current-location-button"
                  style={styles.quickLocationButton}
                  onPress={handleUseCurrentLocation}
                  disabled={isLocating}
                  accessibilityRole="button"
                  accessibilityLabel="Current Location"
                >
                  {isLocating ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Feather name="crosshair" size={15} color={colors.primary} />
                      <Text style={styles.quickLocationButtonText}>Current Location</Text>
                    </>
                  )}
                </Pressable>
              </View>

              {/* Address Line 1 */}
              <Text style={styles.inputLabel}>House / Building / Street *</Text>
              <TextInput
                testID="address-line1-input"
                style={styles.textInput}
                placeholder="Flat / House No. / Floor / Street Name"
                placeholderTextColor={colors.outline}
                value={addressLine1}
                onChangeText={(val) => {
                  setAddressLine1(val);
                  if (formError) setFormError(null);
                }}
              />

              {/* Address Line 2 */}
              <Text style={styles.inputLabel}>Landmark / Area / City / Pincode</Text>
              <TextInput
                testID="address-line2-input"
                style={styles.textInput}
                placeholder="Near landmark, Area, City, Pincode"
                placeholderTextColor={colors.outline}
                value={addressLine2}
                onChangeText={setAddressLine2}
              />

              {/* Primary Address Toggle */}
              <Pressable
                testID="address-primary-checkbox"
                style={styles.primaryToggleRow}
                onPress={() => setIsPrimary((prev) => !prev)}
              >
                <View
                  style={[
                    styles.checkboxBox,
                    isPrimary && styles.checkboxBoxChecked,
                  ]}
                >
                  {isPrimary && (
                    <Feather name="check" size={14} color={colors.onPrimary} />
                  )}
                </View>
                <View style={styles.checkboxLabelContainer}>
                  <Text style={styles.checkboxLabel}>Set as primary address</Text>
                  <Text style={styles.checkboxSubtext}>
                    Automatically preferred for bookings and deliveries
                  </Text>
                </View>
              </Pressable>

              {/* Form Error Notice */}
              {formError ? (
                <View style={styles.errorBox} testID="address-form-error">
                  <Feather name="alert-circle" size={16} color={colors.error} />
                  <Text style={styles.errorText}>{formError}</Text>
                </View>
              ) : null}

              {/* Submit Button */}
              <Pressable
                testID="save-address-submit-button"
                style={[styles.saveSubmitButton, isSaving && { opacity: 0.7 }]}
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color={colors.onPrimary} />
                ) : (
                  <Text style={styles.saveSubmitButtonText}>
                    {editingAddress ? 'Save Changes' : 'Save Address'}
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Select Location on Map Modal */}
      <Modal
        testID="map-picker-modal"
        visible={isMapPickerVisible}
        animationType="slide"
        statusBarTranslucent
        onRequestClose={() => setIsMapPickerVisible(false)}
      >
        <SafeAreaView style={styles.mapPickerSafeArea} edges={['top', 'bottom']}>
          {/* Map Header */}
          <View style={styles.mapPickerHeader}>
            <Pressable
              testID="map-picker-back-button"
              style={styles.iconButton}
              onPress={() => setIsMapPickerVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <Feather name="arrow-left" size={24} color={colors.primary} />
            </Pressable>
            <Text style={styles.mapPickerHeaderTitle}>Select on Map</Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Map Area */}
          <View style={styles.mapPickerCanvasWrapper}>
            <MapCanvas
              style={styles.mapPickerCanvas}
              center={initialMapCenter}
              forceCenterKey={mapForceCenterKey}
              showsUserLocation
              onRegionChangeComplete={handleMapRegionChange}
            >
              {/* Center Pin */}
              <View style={styles.mapCenterPinContainer} pointerEvents="none">
                <View style={styles.mapCenterPin}>
                  <Feather name="map-pin" size={22} color={colors.onPrimary} />
                </View>
                <View style={styles.mapCenterPinDot} />
              </View>
            </MapCanvas>

            {/* GPS Re-center Floating Button */}
            <Pressable
              testID="map-picker-gps-button"
              style={styles.mapGpsButton}
              onPress={handleCenterOnMyLocation}
              accessibilityRole="button"
              accessibilityLabel="My Location"
            >
              <Feather name="crosshair" size={20} color={colors.primary} />
            </Pressable>
          </View>

          {/* Bottom Address Confirmation Sheet */}
          <View style={styles.mapConfirmSheet}>
            <View style={styles.mapConfirmAddressRow}>
              <View style={styles.mapConfirmIconBadge}>
                <Feather name="map-pin" size={20} color={colors.primary} />
              </View>
              <View style={styles.mapConfirmAddressTextContainer}>
                <Text style={styles.mapConfirmLabel}>PINNED LOCATION</Text>
                {isGeocodingMap ? (
                  <View style={styles.geocodingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.geocodingText}>Detecting address...</Text>
                  </View>
                ) : (
                  <Text
                    testID="map-picker-address-text"
                    style={styles.mapConfirmAddress}
                    numberOfLines={2}
                  >
                    {mapAddress || 'Move the map to choose location'}
                  </Text>
                )}
              </View>
            </View>

            <Pressable
              testID="map-picker-confirm-button"
              style={styles.confirmLocationButton}
              onPress={handleConfirmMapLocation}
              accessibilityRole="button"
              accessibilityLabel="Confirm Location"
            >
              <Text style={styles.confirmLocationButtonText}>CONFIRM LOCATION</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface + 'EE',
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
    zIndex: 50,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    gap: spacing.md,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: spacing.xl,
  },
  emptyIconBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  emptyAddButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
  },
  emptyAddButtonText: {
    color: colors.onPrimary,
    fontWeight: '600',
    fontSize: typography.labelSm.fontSize,
  },

  // Card
  card: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    flexDirection: 'column',
    gap: spacing.md,
    position: 'relative',
    overflow: 'hidden',
  },
  primaryAccentLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: colors.secondaryFixed,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainerPrimary: {
    backgroundColor: colors.secondaryContainer,
  },
  cardTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  primaryBadge: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionButton: {
    padding: spacing.sm,
    borderRadius: borderRadius.full,
  },
  addressBody: {
    paddingLeft: 52,
    marginTop: 2,
  },
  addressLine1: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    fontWeight: '500',
  },
  addressLine2Row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  pinIcon: {
    marginTop: 2,
  },
  addressLine2: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    flex: 1,
  },

  // Bottom Action
  bottomActionArea: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainer,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 52,
    borderRadius: borderRadius.full,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(3, 7, 29, 0.5)',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: spacing.sm,
    maxHeight: '90%',
  },
  dragHandleContainer: {
    alignItems: 'center',
    paddingVertical: spacing.xs,
  },
  dragHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceDim,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
  },
  sheetTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  modalCloseButton: {
    padding: spacing.xs,
    borderRadius: borderRadius.full,
  },
  modalFormScroll: {
    paddingHorizontal: spacing.xl,
  },
  modalFormContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.onSurface,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  quickLocationBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  quickLocationButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 42,
    backgroundColor: colors.surfaceContainerLow,
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm,
  },
  quickLocationButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  textInput: {
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    marginBottom: spacing.sm,
  },
  tagChipsScrollView: {
    marginHorizontal: -spacing.xl,
    marginBottom: spacing.sm,
  },
  tagChipsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: 2,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surfaceContainer,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tagChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tagChipText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.onSurfaceVariant,
  },
  tagChipTextSelected: {
    color: colors.onPrimary,
  },
  primaryToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxBoxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkboxLabelContainer: {
    flex: 1,
  },
  checkboxLabel: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },
  checkboxSubtext: {
    fontSize: 12,
    color: colors.onSurfaceVariant,
    marginTop: 2,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.errorContainer,
    marginTop: spacing.sm,
  },
  errorText: {
    color: colors.onErrorContainer,
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  saveSubmitButton: {
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  saveSubmitButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onPrimary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Map Picker Modal Styles
  mapPickerSafeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  mapPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainer,
    zIndex: 20,
  },
  mapPickerHeaderTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.primary,
  },
  mapPickerCanvasWrapper: {
    flex: 1,
    position: 'relative',
  },
  mapPickerCanvas: {
    flex: 1,
  },
  mapCenterPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: [{ translateX: -20 }, { translateY: -40 }],
    alignItems: 'center',
  },
  mapCenterPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  mapCenterPinDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
    marginTop: 4,
    opacity: 0.8,
  },
  mapGpsButton: {
    position: 'absolute',
    right: spacing.md,
    bottom: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.elevated,
  },
  mapConfirmSheet: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainer,
    ...shadows.elevated,
  },
  mapConfirmAddressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  mapConfirmIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  mapConfirmAddressTextContainer: {
    flex: 1,
  },
  mapConfirmLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  mapConfirmAddress: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    lineHeight: 20,
  },
  geocodingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 2,
  },
  geocodingText: {
    fontSize: 12,
    color: colors.onSurfaceVariant,
  },
  confirmLocationButton: {
    backgroundColor: colors.primary,
    height: 50,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLocationButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
});

export default SavedAddressesScreen;
