import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { mockVehicleTypes, strings } from '../../data/mockData';
import Button from '../../components/atoms/Button';
import { Feather } from '@expo/vector-icons';

export interface VehicleSelectionScreenProps {
  readonly onBack?: () => void;
  readonly onContinue?: (vehicleId: string) => void;
  readonly onHelp?: () => void;
}

const VehicleSelectionScreen: React.FC<VehicleSelectionScreenProps & { navigation?: any }> = ({
  onBack,
  onContinue,
  onHelp,
  navigation,
}) => {
  const [selectedId, setSelectedId] = useState<string>('mini-truck');

  const selectedVehicle = mockVehicleTypes.find((v) => v.id === selectedId);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.backButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>{strings.booking.selectVehicle}</Text>
        <Pressable
          style={styles.helpButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
          accessibilityRole="button"
          accessibilityLabel="Help"
        >
          <Text style={styles.helpText}>Help</Text>
        </Pressable>
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.subtitle}>Choose the right vehicle for your load.</Text>

        {mockVehicleTypes.map((vehicle) => {
          const isSelected = vehicle.id === selectedId;
          const isQuoteOnly = vehicle.estimatedPrice === 'Get Quote';

          return (
            <Pressable
              key={vehicle.id}
              style={[
                styles.vehicleCard,
                isSelected && styles.vehicleCardSelected,
              ]}
              onPress={() => setSelectedId(vehicle.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${vehicle.name}, ${vehicle.capacity}, ${vehicle.estimatedPrice}`}
            >
              {/* Selection Check */}
              {isSelected && (
                <View style={styles.checkBadge}>
                  <Feather name="check" size={14} color={colors.onPrimary} />
                </View>
              )}

              {/* Vehicle Image Placeholder */}
              <View style={[styles.vehicleImageBox, isSelected && styles.vehicleImageBoxSelected]}>
                <Feather
                  name={isQuoteOnly ? 'tool' : 'truck'}
                  size={28}
                  color={isSelected ? colors.primary : colors.outlineVariant}
                />
              </View>

              {/* Vehicle Info */}
              <View style={styles.vehicleInfo}>
                <Text style={[styles.vehicleName, isSelected && styles.vehicleNameSelected]}>
                  {vehicle.name}
                </Text>
                <Text style={[styles.vehicleCapacity, isSelected && styles.vehicleCapacitySelected]}>
                  Capacity: {vehicle.capacity}
                </Text>
              </View>

              {/* Price */}
              <View style={styles.priceContainer}>
                <Text
                  style={[
                    isQuoteOnly ? styles.quoteText : styles.priceText,
                    isSelected && !isQuoteOnly && styles.priceTextSelected,
                  ]}
                >
                  {vehicle.estimatedPrice}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.continueButton}
          onPress={() => {
            onContinue?.(selectedId);
            navigation?.navigate('GoodsDetailsScreen');
          }}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          <Text style={styles.continueText}>CONTINUE</Text>
          <View style={styles.continueRight}>
            <Text style={styles.continuePrice}>
              {selectedVehicle?.estimatedPrice ?? ''}
            </Text>
            <Feather name="arrow-right" size={18} color={colors.onPrimary} />
          </View>
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.marginMobile,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  backButton: {
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
  helpButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
  },
  helpText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Content
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: 140,
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.xs,
  },

  // Vehicle Card
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.marginMobile,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 24,
    marginBottom: spacing.marginMobile,
    position: 'relative',
  },
  vehicleCardSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#f8f9fc',
    ...shadows.ghostShadow,
  },
  checkBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },

  // Vehicle Image
  vehicleImageBox: {
    width: 80,
    height: 64,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.marginMobile,
  },
  vehicleImageBoxSelected: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D', // 30% opacity
  },

  // Vehicle Info
  vehicleInfo: {
    flex: 1,
  },
  vehicleName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  vehicleNameSelected: {
    color: colors.primary,
  },
  vehicleCapacity: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 4,
  },
  vehicleCapacitySelected: {
    color: colors.primary + 'B3', // 70% opacity
  },

  // Price
  priceContainer: {
    marginLeft: spacing.sm,
  },
  priceText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  priceTextSelected: {
    color: colors.primary,
  },
  quoteText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainer,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.xxl,
    ...shadows.elevated,
  },
  continueButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
    paddingHorizontal: spacing.xl,
  },
  continueText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  continueRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  continuePrice: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onPrimary,
    opacity: 0.9,
    fontFamily: typography.bodyMd.fontFamily,
  },
});

export default VehicleSelectionScreen;
