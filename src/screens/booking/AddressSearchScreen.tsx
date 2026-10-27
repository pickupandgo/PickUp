import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import { usePlaceSearch } from '../../hooks/usePlaceSearch';
import { useBooking } from '../../state/BookingContext';
import {
  getCurrentPlace,
  searchPlaces,
  LocationPermissionDeniedError,
  type PlaceSuggestion,
  type ResolvedPlace,
} from '../../api/geocoding';
import { toApiError } from '../../api/http';
import { useRecentLocations, saveRecentLocation, type RecentLocation } from '../../state/recentLocations';
import { useSavedAddresses, type SavedAddress } from '../../state/savedAddresses';
import { SkeletonListItem, useSkeletonVisibility } from '../../components/skeleton';

export interface AddressSearchScreenProps {
  readonly route?: {
    params?: {
      mode?: 'pickup' | 'drop';
    };
  };
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly onLocationSelect?: (location: string) => void;
  readonly onMapSelect?: () => void;
  readonly onCurrentLocation?: () => void;
  readonly navigation?: any;
}

const AddressSearchScreen: React.FC<AddressSearchScreenProps & { navigation?: any }> = ({
  route,
  onBack,
  onClose,
  onLocationSelect,
  onMapSelect,
  onCurrentLocation,
  navigation,
}) => {
  const isPickupMode = route?.params?.mode === 'pickup';
  const { draft, setPendingDrop, setPickup, customerId } = useBooking();
  const { locations: recentLocations, isLoading: isRecentLoading } = useRecentLocations(customerId);
  const showRecentSkeleton = useSkeletonVisibility({
    isLoading: isRecentLoading,
    hasData: recentLocations.length > 0,
  });
  // Bias results toward the pickup point so short queries resolve locally.
  const { query, setQuery, suggestions, isSearching, error, resolve, clear } = usePlaceSearch(
    draft.pickup
  );
  const [isResolving, setIsResolving] = useState(false);
  const [actionError, setActionError] = useState<string>();

  /** Resolves a suggestion to coordinates, then moves to the map confirm step. */
  const handleSelectSuggestion = async (suggestion: PlaceSuggestion) => {
    setIsResolving(true);
    setActionError(undefined);
    try {
      const place = await resolve(suggestion);
      if (isPickupMode) {
        setPickup(place);
      } else {
        setPendingDrop(place);
      }
      void saveRecentLocation(
        {
          name: suggestion.primaryText,
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          placeId: place.placeId || suggestion.placeId,
        },
        customerId
      );
      onLocationSelect?.(place.address);
      if (isPickupMode) {
        navigation?.navigate('SelectLocationScreen', { mode: 'pickup' });
      } else {
        navigation?.navigate('SelectDropLocationScreen');
      }
    } catch (caught) {
      setActionError(toApiError(caught).userMessage);
    } finally {
      setIsResolving(false);
    }
  };

  /** Uses the device GPS position as the location. */
  const handleCurrentLocation = async () => {
    setIsResolving(true);
    setActionError(undefined);
    try {
      const place = await getCurrentPlace();
      if (isPickupMode) {
        setPickup(place);
      } else {
        setPendingDrop(place);
      }
      void saveRecentLocation(
        {
          name: 'Current Location',
          address: place.address,
          latitude: place.latitude,
          longitude: place.longitude,
          placeId: place.placeId,
        },
        customerId
      );
      onCurrentLocation?.();
      if (isPickupMode) {
        navigation?.navigate('SelectLocationScreen', { mode: 'pickup' });
      } else {
        navigation?.navigate('SelectDropLocationScreen');
      }
    } catch (caught) {
      setActionError(
        caught instanceof LocationPermissionDeniedError
          ? 'Location permission is off. Enable it in Settings to use your current location.'
          : toApiError(caught).userMessage
      );
    } finally {
      setIsResolving(false);
    }
  };

  /** Reuses a saved recent search location directly. */
  const handleSelectRecent = (loc: RecentLocation) => {
    const place = {
      address: loc.address,
      latitude: loc.latitude,
      longitude: loc.longitude,
      placeId: loc.placeId,
    };
    if (isPickupMode) {
      setPickup(place);
    } else {
      setPendingDrop(place);
    }
    void saveRecentLocation(loc, customerId);
    onLocationSelect?.(loc.address);
    if (isPickupMode) {
      navigation?.navigate('SelectLocationScreen', { mode: 'pickup' });
    } else {
      navigation?.navigate('SelectDropLocationScreen');
    }
  };

  const hasQuery = query.trim().length > 0;
  const { addresses: savedAddresses } = useSavedAddresses(customerId);

  const matchingSavedAddresses = useMemo(() => {
    if (!hasQuery) return [];
    const q = query.trim().toLowerCase();
    return savedAddresses.filter(
      (addr) =>
        addr.title.toLowerCase().includes(q) ||
        addr.addressLine1.toLowerCase().includes(q) ||
        (addr.addressLine2 && addr.addressLine2.toLowerCase().includes(q))
    );
  }, [hasQuery, query, savedAddresses]);

  const getSavedAddressIcon = (icon?: string): string => {
    switch (icon) {
      case 'home':
        return 'home';
      case 'briefcase':
        return 'briefcase';
      case 'box':
        return 'package';
      default:
        return 'map-pin';
    }
  };

  /** Reuses a saved address (Home, Office, etc.) directly. */
  const handleSelectSaved = async (addr: SavedAddress) => {
    setIsResolving(true);
    setActionError(undefined);
    try {
      let lat = addr.latitude;
      let lng = addr.longitude;
      const fullAddress = [addr.addressLine1, addr.addressLine2].filter(Boolean).join(', ');

      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        // Fallback: resolve coordinates if not stored
        const results = await searchPlaces(fullAddress, { origin: draft.pickup }).catch(() => []);
        if (results && results.length > 0) {
          const resolved = await resolve(results[0]);
          lat = resolved.latitude;
          lng = resolved.longitude;
        } else {
          lat = draft.pickup?.latitude ?? 26.2389;
          lng = draft.pickup?.longitude ?? 73.0243;
        }
      }

      const place: ResolvedPlace = {
        address: fullAddress,
        latitude: lat,
        longitude: lng,
      };

      if (isPickupMode) {
        setPickup(place);
      } else {
        setPendingDrop(place);
      }

      void saveRecentLocation(
        {
          name: addr.title,
          address: fullAddress,
          latitude: lat,
          longitude: lng,
        },
        customerId
      );

      onLocationSelect?.(fullAddress);
      if (isPickupMode) {
        navigation?.navigate('SelectLocationScreen', { mode: 'pickup' });
      } else {
        navigation?.navigate('SelectDropLocationScreen');
      }
    } catch (caught) {
      setActionError(toApiError(caught).userMessage);
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable style={styles.iconButton} onPress={() => (onClose ? onClose() : navigation?.goBack())}>
          <Feather name="x" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.mainContent}>
          {/* Search Input Area */}
          <View style={styles.searchContainer}>
            <View style={styles.searchInputWrapper}>
              <Feather name="search" size={20} color={colors.onSurfaceVariant} style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search location"
                placeholderTextColor={colors.onSurfaceVariant}
                value={query}
                onChangeText={setQuery}
                autoFocus
                autoCorrect={false}
                returnKeyType="search"
              />
              {isSearching && <ActivityIndicator size="small" color={colors.onSurfaceVariant} />}
              {hasQuery && !isSearching && (
                <Pressable onPress={clear} style={styles.clearButton} accessibilityLabel="Clear search">
                  <MaterialIcons name="cancel" size={20} color={colors.onSurfaceVariant} />
                </Pressable>
              )}
            </View>
          </View>

          {/* Current Location & Map Actions */}
          <View style={styles.quickActionsContainer}>
            <Pressable
              style={styles.quickActionBtn}
              onPress={handleCurrentLocation}
              disabled={isResolving}
            >
              <Feather name="navigation" size={20} color={colors.primary} />
              <Text style={styles.quickActionText}>Current Location</Text>
            </Pressable>
            
            <View style={{ width: 1, backgroundColor: colors.outlineVariant, marginHorizontal: spacing.sm }} />
            
            <Pressable
              style={styles.quickActionBtn}
              onPress={() => {
                onMapSelect?.();
                if (isPickupMode) {
                  navigation?.navigate('SelectLocationScreen', { mode: 'pickup' });
                } else {
                  navigation?.navigate('SelectDropLocationScreen');
                }
              }}
            >
              <Feather name="map" size={20} color={colors.primary} />
              <Text style={styles.quickActionText}>Locate on Map</Text>
            </Pressable>
          </View>

          {/* Live results from Google Places, Saved Addresses, or Recent Searches */}
          <View style={styles.listContainer}>
            {(actionError || error) && (
              <View style={styles.messageRow}>
                <Feather name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorMessage}>{actionError ?? error?.userMessage}</Text>
              </View>
            )}

            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
              {!hasQuery && (
                <>
                  {/* Saved Addresses Section (Home, Office, etc.) */}
                  {savedAddresses.length > 0 && (
                    <View style={styles.savedSection}>
                      <View style={styles.sectionHeaderRow}>
                        <Text style={styles.listTitle}>SAVED PLACES</Text>
                        <Pressable
                          onPress={() => navigation?.navigate('SavedAddressesScreen')}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Manage saved addresses"
                        >
                          <Text style={styles.manageLink}>Manage</Text>
                        </Pressable>
                      </View>

                      {savedAddresses.map((addr) => (
                        <Pressable
                          key={addr.id}
                          style={styles.locationItem}
                          onPress={() => handleSelectSaved(addr)}
                          disabled={isResolving}
                          accessibilityRole="button"
                          accessibilityLabel={`${addr.title}, ${addr.addressLine1}`}
                        >
                          <View style={[styles.iconContainer, styles.savedIconContainer]}>
                            <Feather name={getSavedAddressIcon(addr.icon)} size={18} color={colors.primary} />
                          </View>
                          <View style={styles.locationTextContainer}>
                            <View style={styles.titleBadgeRow}>
                              <Text style={styles.locationName}>{addr.title}</Text>
                              {addr.isPrimary && (
                                <View style={styles.primaryBadge}>
                                  <Text style={styles.primaryBadgeText}>DEFAULT</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.locationAddress} numberOfLines={1}>
                              {addr.addressLine1}
                              {addr.addressLine2 ? `, ${addr.addressLine2}` : ''}
                            </Text>
                          </View>
                          <Feather name="chevron-right" size={16} color={colors.outlineVariant} style={{ marginTop: 4 }} />
                        </Pressable>
                      ))}

                      <View style={styles.sectionDivider} />
                    </View>
                  )}

                  {/* Recent Searches Section */}
                  <View style={styles.recentSection}>
                    <Text style={styles.listTitle}>RECENT SEARCHES</Text>
                    {showRecentSkeleton ? (
                      <SkeletonListItem count={3} hasAvatar={true} hasSubtitle={true} />
                    ) : recentLocations.length > 0 ? (
                      recentLocations.map((loc) => (
                        <Pressable
                          key={loc.id}
                          style={styles.locationItem}
                          onPress={() => handleSelectRecent(loc)}
                          disabled={isResolving}
                          accessibilityRole="button"
                          accessibilityLabel={loc.address}
                        >
                          <View style={styles.iconContainer}>
                            <Feather name="clock" size={20} color={colors.onSurfaceVariant} />
                          </View>
                          <View style={styles.locationTextContainer}>
                            <Text style={styles.locationName}>{loc.name}</Text>
                            <Text style={styles.locationAddress} numberOfLines={1}>
                              {loc.address}
                            </Text>
                          </View>
                        </Pressable>
                      ))
                    ) : (
                      <View style={styles.emptyRecentCard}>
                        <View style={styles.emptyRecentIconWrapper}>
                          <Feather name="map-pin" size={20} color={colors.onSurfaceVariant} />
                        </View>
                        <Text style={styles.emptyRecentTitle}>No recent searches yet.</Text>
                        <Text style={styles.emptyRecentSubtitle}>
                          Your searched locations will appear here.
                        </Text>
                      </View>
                    )}
                  </View>
                </>
              )}

              {hasQuery && (
                <>
                  {matchingSavedAddresses.length > 0 && (
                    <View style={styles.savedSection}>
                      <Text style={styles.listTitle}>MATCHING SAVED PLACES</Text>
                      {matchingSavedAddresses.map((addr) => (
                        <Pressable
                          key={`match-${addr.id}`}
                          style={styles.locationItem}
                          onPress={() => handleSelectSaved(addr)}
                          disabled={isResolving}
                          accessibilityRole="button"
                          accessibilityLabel={`${addr.title}, ${addr.addressLine1}`}
                        >
                          <View style={[styles.iconContainer, styles.savedIconContainer]}>
                            <Feather name={getSavedAddressIcon(addr.icon)} size={18} color={colors.primary} />
                          </View>
                          <View style={styles.locationTextContainer}>
                            <View style={styles.titleBadgeRow}>
                              <Text style={styles.locationName}>{addr.title}</Text>
                              <View style={styles.savedChipBadge}>
                                <Text style={styles.savedChipBadgeText}>SAVED</Text>
                              </View>
                            </View>
                            <Text style={styles.locationAddress} numberOfLines={1}>
                              {addr.addressLine1}
                              {addr.addressLine2 ? `, ${addr.addressLine2}` : ''}
                            </Text>
                          </View>
                          <Feather name="chevron-right" size={16} color={colors.outlineVariant} style={{ marginTop: 4 }} />
                        </Pressable>
                      ))}
                      <View style={styles.sectionDivider} />
                    </View>
                  )}

                  <Text style={styles.listTitle}>SEARCH RESULTS</Text>

                  {!isSearching && !suggestions.length && !error && matchingSavedAddresses.length === 0 && (
                    <Text style={styles.hintText}>No places matched that search.</Text>
                  )}

                  {suggestions.map((suggestion) => (
                    <Pressable
                      key={suggestion.placeId}
                      style={styles.locationItem}
                      onPress={() => handleSelectSuggestion(suggestion)}
                      disabled={isResolving}
                      accessibilityRole="button"
                      accessibilityLabel={suggestion.description}
                    >
                      <View style={styles.iconContainer}>
                        <Feather name="map-pin" size={20} color={colors.onSurfaceVariant} />
                      </View>
                      <View style={styles.locationTextContainer}>
                        <Text style={styles.locationName}>{suggestion.primaryText}</Text>
                        {suggestion.secondaryText.length > 0 && (
                          <Text style={styles.locationAddress}>{suggestion.secondaryText}</Text>
                        )}
                      </View>
                    </Pressable>
                  ))}
                </>
              )}
            </ScrollView>

            {isResolving && (
              <View style={styles.messageRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.hintText}>Getting location details…</Text>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  errorMessage: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.error,
    fontFamily: typography.bodyMd.fontFamily,
  },
  hintText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    paddingVertical: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  mainContent: {
    flex: 1,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.md,
  },
  searchContainer: {
    marginBottom: spacing.lg,
  },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    height: 48,
  },
  searchIcon: {
    marginRight: spacing.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
    height: '100%',
  },
  clearButton: {
    marginLeft: spacing.sm,
    padding: 4,
  },
  quickActionsContainer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  quickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.secondaryContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  quickActionText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSecondaryContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  listContainer: {
    flex: 1,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  listTitle: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.xxxl,
  },
  locationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant + '4D', // 30% opacity
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  locationTextContainer: {
    flex: 1,
  },
  locationName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: 4,
  },
  locationAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  recentSection: {
    marginBottom: spacing.md,
  },
  recentTitle: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: spacing.xs,
  },
  loadingContainer: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyRecentCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.lg,
  },
  emptyRecentIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyRecentTitle: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptyRecentSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textAlign: 'center',
  },
  savedSection: {
    marginBottom: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  manageLink: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  savedIconContainer: {
    backgroundColor: colors.primaryFixed,
  },
  titleBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 4,
  },
  primaryBadge: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.xs,
  },
  primaryBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.onPrimary,
    letterSpacing: 0.5,
  },
  savedChipBadge: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.xs,
  },
  savedChipBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    letterSpacing: 0.5,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: colors.outlineVariant + '4D',
    marginVertical: spacing.md,
  },
});

export default AddressSearchScreen;
