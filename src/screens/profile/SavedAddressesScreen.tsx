import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';

export interface SavedAddress {
  id: string;
  title: string;
  icon: 'home' | 'briefcase' | 'box';
  isPrimary?: boolean;
  addressLine1: string;
  addressLine2: string;
}

const MOCK_ADDRESSES: SavedAddress[] = [
  {
    id: '1',
    title: 'Home',
    icon: 'home',
    isPrimary: true,
    addressLine1: '12, Sector C, Shastri Nagar',
    addressLine2: 'Near Shiva Temple, Jodhpur, 342003',
  },
  {
    id: '2',
    title: 'Office',
    icon: 'briefcase',
    addressLine1: 'Tech Hub, 4th Floor, Ratanada',
    addressLine2: 'Opposite Circuit House, Jodhpur, 342011',
  },
  {
    id: '3',
    title: 'Warehouse B',
    icon: 'box',
    addressLine1: 'Plot 45, Basni Industrial Area Phase II',
    addressLine2: 'Near AIIMS Road, Jodhpur, 342005',
  },
];

export interface SavedAddressesScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
  readonly onEditAddress?: (addressId: string) => void;
  readonly onDeleteAddress?: (addressId: string) => void;
  readonly onAddAddress?: () => void;
}

const SavedAddressesScreen: React.FC<SavedAddressesScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  onEditAddress,
  onDeleteAddress,
  onAddAddress,
  navigation,
}) => {
  const [addresses, setAddresses] = useState<SavedAddress[]>(MOCK_ADDRESSES);

  const handleDelete = (addressId: string) => {
    onDeleteAddress?.(addressId);
    setAddresses((prev) => prev.filter((item) => item.id !== addressId));
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.iconButton} onPress={() => navigation?.goBack()}>
            <Feather name="arrow-left" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>Saved Addresses</Text>
        </View>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Feather name="help-circle" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {addresses.map((address) => (
          <View key={address.id} style={styles.card}>
            {address.isPrimary && <View style={styles.primaryAccentLine} />}
            
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <View style={[styles.iconContainer, address.isPrimary && styles.iconContainerPrimary]}>
                  <Feather
                    name={address.icon}
                    size={20}
                    color={address.isPrimary ? colors.onSecondaryContainer : colors.onSurfaceVariant}
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
                  style={styles.actionButton}
                  onPress={() => {
                    onEditAddress?.(address.id);
                    navigation?.navigate('SelectDropLocationScreen');
                  }}
                >
                  <Feather name="edit-2" size={20} color={colors.onSurfaceVariant} />
                </Pressable>
                <Pressable
                  style={styles.actionButton}
                  onPress={() => handleDelete(address.id)}
                >
                  <Feather name="trash-2" size={20} color={colors.onSurfaceVariant} />
                </Pressable>
              </View>
            </View>

            <View style={styles.addressBody}>
              <Text style={styles.addressLine1}>{address.addressLine1}</Text>
              <View style={styles.addressLine2Row}>
                <Feather name="map-pin" size={16} color={colors.onSurfaceVariant} />
                <Text style={styles.addressLine2}>{address.addressLine2}</Text>
              </View>
            </View>
          </View>
        ))}
        
        {/* Spacer for floating button */}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Fixed Bottom Action Area (Mobile) */}
      <View style={styles.bottomActionArea}>
        <Pressable
          style={styles.addButton}
          onPress={() => (onAddAddress ? onAddAddress() : navigation?.navigate('AddressSearchScreen'))}
        >
          <Feather name="plus" size={24} color={colors.onPrimary} />
          <Text style={styles.addButtonText}>Add New Address</Text>
        </Pressable>
      </View>
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
    backgroundColor: colors.surface + 'CC', // 80% opacity fallback for blur
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
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.lg,
    gap: spacing.md,
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
    paddingLeft: 52, // 40 (icon) + 12 (gap)
    marginTop: 4,
  },
  addressLine1: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  addressLine2Row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    marginTop: 4,
  },
  addressLine2: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    flex: 1,
  },

  // Bottom Action
  bottomActionArea: {
    position: 'absolute',
    bottom: spacing.rowHeightStandard,
    left: 0,
    right: 0,
    padding: spacing.marginMobile,
    backgroundColor: colors.surface + 'E6', // 90% opacity
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
    zIndex: 40,
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
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelSm.letterSpacing,
  },
});

export default SavedAddressesScreen;
