import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { usePlaceSearch } from '../../hooks/usePlaceSearch';
import { useBooking } from '../../state/BookingContext';
import { getCurrentPlace, LocationPermissionDeniedError, type PlaceSuggestion } from '../../api/geocoding';
import { toApiError } from '../../api/http';

export interface AddressSearchScreenProps {
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly onLocationSelect?: (location: string) => void;
  readonly onMapSelect?: () => void;
  readonly onCurrentLocation?: () => void;
}

const AddressSearchScreen: React.FC<AddressSearchScreenProps & { navigation?: any }> = ({
  onBack,
  onClose,
  onLocationSelect,
  onMapSelect,
  onCurrentLocation,
  navigation,
}) => {
  const { draft, setPendingDrop } = useBooking();
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
      setPendingDrop(place);
      onLocationSelect?.(place.address);
      navigation?.navigate('SelectDropLocationScreen');
    } catch (caught) {
      setActionError(toApiError(caught).userMessage);
    } finally {
      setIsResolving(false);
    }
  };

  /** Uses the device GPS position as the drop. */
  const handleCurrentLocation = async () => {
    setIsResolving(true);
    setActionError(undefined);
    try {
      const place = await getCurrentPlace();
      setPendingDrop(place);
      onCurrentLocation?.();
      navigation?.navigate('SelectDropLocationScreen');
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

  const hasQuery = query.trim().length > 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Pick Up</Text>
        <Pressable style={styles.iconButton} onPress={() => (onClose ? onClose() : navigation?.navigate('HomeScreen'))}>
          <Feather name="x" size={24} color={colors.primary} />
        </Pressable>
      </View>

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
                navigation?.navigate('SelectDropLocationScreen');
              }}
            >
              <Feather name="map" size={20} color={colors.primary} />
              <Text style={styles.quickActionText}>Locate on Map</Text>
            </Pressable>
          </View>

        {/* Live results from Google Places */}
        <View style={styles.listContainer}>
          <Text style={styles.listTitle}>
            {hasQuery ? 'SEARCH RESULTS' : 'SEARCH FOR A DROP LOCATION'}
          </Text>

          {(actionError || error) && (
            <View style={styles.messageRow}>
              <Feather name="alert-circle" size={16} color={colors.error} />
              <Text style={styles.errorMessage}>{actionError ?? error?.userMessage}</Text>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            {!hasQuery && !actionError && (
              <Text style={styles.hintText}>
                Start typing an address, or use your current location.
              </Text>
            )}

            {hasQuery && !isSearching && !suggestions.length && !error && (
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
          </ScrollView>

          {isResolving && (
            <View style={styles.messageRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.hintText}>Getting location details…</Text>
            </View>
          )}
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
});

export default AddressSearchScreen;
