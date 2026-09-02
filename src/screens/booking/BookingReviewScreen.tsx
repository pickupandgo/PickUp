import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockBookingReview } from '../../data/mockData';
import { Feather } from '@expo/vector-icons';

export interface BookingReviewScreenProps {
  readonly onBack?: () => void;
  readonly onConfirm?: () => void;
  readonly onEditPickup?: () => void;
  readonly onEditDrops?: () => void;
  readonly onEditVehicle?: () => void;
  readonly onEditGoods?: () => void;
  readonly onEditInsurance?: () => void;
  readonly onEditPayment?: () => void;
}

interface ReviewSectionProps {
  readonly icon: string;
  readonly label: string;
  readonly children: React.ReactNode;
  readonly onEdit?: () => void;
}

const ReviewSection: React.FC<ReviewSectionProps> = ({ icon, label, children, onEdit }) => (
  <View style={sectionStyles.card}>
    <View style={sectionStyles.header}>
      <View style={sectionStyles.headerLeft}>
        <Feather name={icon as any} size={14} color={colors.primary} />
        <Text style={sectionStyles.label}>{label}</Text>
      </View>
      {onEdit && (
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={`Edit ${label}`}>
          <Text style={sectionStyles.editText}>Edit</Text>
        </Pressable>
      )}
    </View>
    {children}
  </View>
);

const sectionStyles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHigh + '80',
    ...shadows.ghostShadow,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  label: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  editText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
});

const BookingReviewScreen: React.FC<BookingReviewScreenProps & { navigation?: any }> = ({
  onBack,
  onConfirm,
  onEditPickup,
  onEditDrops,
  onEditVehicle,
  onEditGoods,
  onEditInsurance,
  onEditPayment,
  navigation,
}) => {
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
        <Text style={styles.headerTitle}>{strings.booking.reviewBooking}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Pickup */}
        <ReviewSection
          icon="circle"
          label="Pickup"
          onEdit={() => (onEditPickup ? onEditPickup() : navigation?.navigate('SelectLocationScreen'))}
        >
          <Text style={styles.sectionValue}>Sardarpura Warehouse</Text>
        </ReviewSection>

        {/* Drops */}
        <ReviewSection
          icon="map-pin"
          label="Drops"
          onEdit={() => (onEditDrops ? onEditDrops() : navigation?.navigate('MultiDropOverviewScreen'))}
        >
          <View style={styles.dropsContainer}>
            <View style={styles.dropsLine} />
            {['Ratanada Hub', 'Pal Road', 'Basni Phase II'].map((drop, index) => (
              <View key={drop} style={styles.dropItem}>
                <View style={styles.dropDot} />
                <Text style={styles.sectionValue}>{drop}</Text>
              </View>
            ))}
          </View>
        </ReviewSection>

        {/* Vehicle */}
        <ReviewSection
          icon="truck"
          label="Vehicle"
          onEdit={() => (onEditVehicle ? onEditVehicle() : navigation?.navigate('SelectVehicleScreen'))}
        >
          <Text style={styles.sectionValue}>{mockBookingReview.vehicleType}</Text>
        </ReviewSection>

        {/* Goods */}
        <ReviewSection
          icon="package"
          label="Goods"
          onEdit={() => (onEditGoods ? onEditGoods() : navigation?.navigate('GoodsDetailsScreen'))}
        >
          <Text style={styles.sectionValue}>3 boxes of kitchenware</Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}>
              <Text style={styles.chipText}>450 kg</Text>
            </View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>₹ 50,000</Text>
            </View>
          </View>
        </ReviewSection>

        {/* Insurance & Payment - Two Column */}
        <View style={styles.twoColRow}>
          <ReviewSection
            icon="shield"
            label="Insurance"
            onEdit={() => (onEditInsurance ? onEditInsurance() : navigation?.navigate('GoodsInsuranceScreen'))}
          >
            <Text style={styles.primaryValue}>Selected</Text>
          </ReviewSection>

          <ReviewSection
            icon="credit-card"
            label="Payment"
            onEdit={() => (onEditPayment ? onEditPayment() : navigation?.navigate('PaymentMethodScreen'))}
          >
            <Text style={styles.sectionValue}>Pay via UPI</Text>
          </ReviewSection>
        </View>

        {/* Fare */}
        <View style={styles.fareCard}>
          <View style={styles.fareLeft}>
            <Text style={styles.fareLabel}>ESTIMATED FARE</Text>
            <Text style={styles.fareAmount}>₹ 450.00</Text>
          </View>
          <View style={styles.fareDetailsButton}>
            <Text style={styles.fareDetailsText}>Details</Text>
            <Feather name="chevron-down" size={16} color={colors.onSurfaceVariant} />
          </View>
        </View>
      </ScrollView>

      {/* Bottom Action Bar */}
      <View style={styles.bottomBar}>
        <Pressable
          style={styles.confirmButton}
          onPress={() => {
            onConfirm?.();
            navigation?.navigate('ValidateBookingScreen');
          }}
          accessibilityRole="button"
          accessibilityLabel="Confirm Booking"
        >
          <Text style={styles.confirmText}>CONFIRM BOOKING</Text>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceContainerHigh,
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
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  headerSpacer: {
    width: 40,
  },

  // Content
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.xl,
    paddingBottom: 140,
    gap: spacing.marginMobile,
  },

  // Section values
  sectionValue: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onBackground,
    fontFamily: typography.bodyLg.fontFamily,
    marginLeft: spacing.xl,
  },
  primaryValue: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '500',
    color: colors.primary,
    fontFamily: typography.bodyLg.fontFamily,
  },

  // Drops
  dropsContainer: {
    marginLeft: spacing.xl,
    position: 'relative',
  },
  dropsLine: {
    position: 'absolute',
    left: -12,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: colors.surfaceContainerHigh,
  },
  dropItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  dropDot: {
    position: 'absolute',
    left: -16,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.secondaryFixedDim,
  },

  // Chips
  chipRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginLeft: spacing.xl,
    marginTop: spacing.sm,
  },
  chip: {
    backgroundColor: colors.surfaceContainer,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  chipText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.dataMono.fontFamily,
  },

  // Two Column
  twoColRow: {
    flexDirection: 'row',
    gap: spacing.marginMobile,
  },

  // Fare
  fareCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: 24,
    padding: spacing.xl,
    borderWidth: 1,
    borderColor: colors.surfaceContainer,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  fareLeft: {
    gap: 2,
  },
  fareLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '500',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fareAmount: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  fareDetailsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  fareDetailsText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },

  // Bottom Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface + 'E6', // 90%
    borderTopWidth: 1,
    borderTopColor: colors.surfaceContainerHigh,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.marginMobile,
    paddingBottom: spacing.xxl,
  },
  confirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.marginMobile,
    paddingHorizontal: spacing.xl,
    ...shadows.elevated,
  },
  confirmText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
});

export default BookingReviewScreen;
