import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';

export interface ValidateBookingScreenProps {
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
}

const ValidateBookingScreen: React.FC<ValidateBookingScreenProps & { navigation?: any }> = ({
  onBack,
  onHelp,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
        <Text style={styles.headerTitle}>Validate Booking</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Feather name="help-circle" size={24} color={colors.onSurfaceVariant} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Section 1: Route Validation */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>ROUTE VALIDATION</Text>
          
          <View style={styles.inputCard}>
            <MaterialIcons name="my-location" size={16} color={colors.primary} />
            <View style={styles.inputContent}>
              <Text style={styles.inputLabel}>Pickup</Text>
              <Text style={styles.inputText} numberOfLines={1}>123 Main St, San Francisco, CA 94105</Text>
            </View>
          </View>
          
          <View style={styles.stemContainer}>
            <View style={styles.stemLine} />
          </View>
          
          <View>
            <View style={[styles.inputCard, styles.errorBorder]}>
              <MaterialIcons name="location-on" size={16} color={colors.outline} />
              <View style={styles.inputContent}>
                <Text style={styles.errorLabel}>Drop</Text>
                <TextInput
                  style={styles.disabledInput}
                  placeholder="Enter drop location"
                  placeholderTextColor={colors.outline}
                  editable={false}
                />
              </View>
            </View>
            <View style={styles.errorTextRow}>
              <MaterialIcons name="error" size={14}  />
              <Text style={styles.errorText}>Drop location is required</Text>
            </View>
          </View>
        </View>

        {/* Section 2: Receiver Info */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>RECEIVER INFO</Text>
          
          <View style={styles.fieldGroup}>
            <View style={styles.inputCard}>
              <View style={styles.inputContent}>
                <Text style={styles.inputLabel}>Name</Text>
                <Text style={styles.inputText}>John Doe</Text>
              </View>
            </View>
          </View>

          <View style={styles.fieldGroup}>
            <View style={[styles.inputCard, styles.errorBorder]}>
              <View style={styles.inputContent}>
                <Text style={styles.errorLabel}>Phone Number</Text>
                <TextInput
                  style={styles.disabledInput}
                  value="555-123"
                  editable={false}
                  
                />
              </View>
            </View>
            <View style={styles.errorTextRow}>
              <MaterialIcons name="error" size={14}  />
              <Text style={styles.errorText}>Enter a valid 10-digit number</Text>
            </View>
          </View>
        </View>

        {/* Section 3: Vehicle Selection */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>VEHICLE SELECTION</Text>
          
          <View style={styles.infoBanner}>
            <MaterialIcons name="info" size={16} color={colors.onErrorContainer} />
            <Text style={styles.infoBannerText}>Please select a vehicle to continue</Text>
          </View>

          <View style={styles.vehicleGrid}>
            <View style={styles.vehicleCard}>
              <MaterialIcons name="electric-rickshaw" size={24} color={colors.onSurfaceVariant} />
              <Text style={styles.vehicleLabel}>Auto</Text>
            </View>
            <View style={styles.vehicleCard}>
              <MaterialIcons name="local-taxi" size={24} color={colors.onSurfaceVariant} />
              <Text style={styles.vehicleLabel}>Cab</Text>
            </View>
            <View style={styles.vehicleCard}>
              <MaterialIcons name="airport-shuttle" size={24} color={colors.onSurfaceVariant} />
              <Text style={styles.vehicleLabel}>Van</Text>
            </View>
          </View>
        </View>

        {/* Section 4: Goods Details */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>GOODS DETAILS</Text>
          
          <View style={styles.fieldGroup}>
            <View style={[styles.inputCard, styles.errorBorder]}>
              <View style={styles.inputContent}>
                <Text style={styles.errorLabel}>Goods Description</Text>
                <TextInput
                  style={styles.disabledInput}
                  placeholder="e.g. Electronics, Furniture"
                  placeholderTextColor={colors.outline}
                  editable={false}
                />
              </View>
            </View>
            <View style={styles.errorTextRow}>
              <MaterialIcons name="error" size={14}  />
              <Text style={styles.errorText}>Description required</Text>
            </View>
          </View>

          <View style={styles.rowGrid}>
            <View style={styles.rowGridItem}>
              <View style={[styles.inputCard, styles.errorBorder]}>
                <View style={styles.inputContent}>
                  <Text style={styles.errorLabel}>Weight (kg)</Text>
                  <TextInput
                    style={styles.disabledInput}
                    value="0"
                    editable={false}
                    
                  />
                </View>
              </View>
              <View style={styles.errorTextRow}>
                <MaterialIcons name="error" size={14}  />
                <Text style={styles.errorText}>Weight must be &gt; 0</Text>
              </View>
            </View>

            <View style={styles.rowGridItem}>
              <View style={[styles.inputCard, styles.errorBorder]}>
                <View style={styles.inputContent}>
                  <Text style={styles.errorLabel}>Value ($)</Text>
                  <TextInput
                    style={styles.disabledInput}
                    value="-100"
                    editable={false}
                    
                  />
                </View>
              </View>
              <View style={styles.errorTextRow}>
                <MaterialIcons name="error" size={14}  />
                <Text style={styles.errorText}>Cannot be negative</Text>
              </View>
            </View>
          </View>
        </View>

      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.confirmButton}
          onPress={() => navigation?.navigate('BookingConfirmedScreen')}
          accessibilityRole="button"
          accessibilityLabel="Confirm and book"
        >
          <Text style={styles.confirmText}>CONFIRM &amp; BOOK</Text>
          <Feather name="arrow-right" size={18} color={colors.onPrimary} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    textAlign: 'center',
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  sectionCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  fieldGroup: {
    gap: 4,
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorBorder: {
    borderWidth: 1,
    borderColor: colors.error,
  },
  inputContent: {
    flex: 1,
  },
  inputLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 2,
  },
  errorLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 2,
  },
  inputText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  disabledInput: {
    padding: 0,
    fontSize: typography.bodyMd.fontSize,
    fontFamily: typography.bodyMd.fontFamily,
  },
  stemContainer: {
    paddingLeft: spacing.lg,
    paddingVertical: spacing.xs,
  },
  stemLine: {
    width: 1,
    height: 16,
    backgroundColor: colors.outlineVariant,
  },
  errorTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: spacing.lg,
    marginTop: 4,
  },
  errorText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.error,
    fontFamily: typography.labelSm.fontFamily,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  infoBannerText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onErrorContainer,
    fontFamily: typography.labelSm.fontFamily,
  },
  vehicleGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  vehicleCard: {
    flex: 1,
    backgroundColor: colors.surfaceVariant,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  vehicleLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.labelSm.fontFamily,
  },
  rowGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowGridItem: {
    flex: 1,
    gap: 4,
  },

  // Bottom Bar
  bottomBar: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant + '33', // 20%
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.marginMobile,
  },
  confirmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    ...shadows.elevated,
  },
  confirmText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default ValidateBookingScreen;
