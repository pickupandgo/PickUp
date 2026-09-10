import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockBookingReview, mockVehicleTypes } from '../../data/mockData';
import { useBooking } from '../../state/BookingContext';
import TopAppBar from '../../components/organisms/TopAppBar';
import Card from '../../components/molecules/Card';
import LocationInputRow from '../../components/molecules/LocationInputRow';
import ListRow from '../../components/molecules/ListRow';
import Divider from '../../components/atoms/Divider';
import Button from '../../components/atoms/Button';
import Feather from '@expo/vector-icons/Feather';

export interface ReviewBookingScreenProps {
  readonly onBack?: () => void;
  readonly onConfirm?: () => void;
  readonly onEditPickup?: () => void;
  readonly onEditDrop?: () => void;
  readonly onChangeVehicle?: () => void;
  readonly onChangePayment?: () => void;
}

const ReviewBookingScreen: React.FC<ReviewBookingScreenProps & { navigation?: any }> = ({
  onBack,
  onConfirm,
  onEditPickup,
  onEditDrop,
  onChangeVehicle,
  onChangePayment,
  navigation,
}) => {
  const { draft } = useBooking();
  const estimate = draft.fareEstimate;
  const [isAddressExpanded, setIsAddressExpanded] = useState(false);

  // Fallback vehicle info if somehow unselected, but we assume select vehicle always passes one
  const vehicleName = draft.vehicleType ?? mockBookingReview.vehicleType;
  const vehicle = mockVehicleTypes.find((v) => v.name === vehicleName) || mockVehicleTypes[2];

  // Address logic
  const pickupAddress = draft.pickup?.address ?? mockBookingReview.pickup;
  const dropAddresses = draft.drops.length
    ? draft.drops.map((d) => d.address)
    : mockBookingReview.drops;
  
  const estimatedFare = estimate ? `₹${estimate.fare}` : mockBookingReview.estimatedFare;
  const etaMinutes = estimate?.durationMin ?? (parseInt(vehicle.eta) || 30);

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopAppBar
        title="Review Booking"
        leadingIcon={<Feather name="arrow-left" size={24} color={colors.onSurface} />}
        onLeadingPress={() => (onBack ? onBack() : navigation?.goBack())}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Selected Vehicle Card */}
        <Card variant="outlined" padding="none" style={styles.vehicleCardWrapper}>
          <View style={styles.vehicleCardTop}>
            <Image source={vehicle.image} style={styles.vehicleImage} resizeMode="contain" />
            <View style={styles.vehicleInfo}>
              <Text style={styles.vehicleName}>{vehicleName}</Text>
              <Pressable onPress={() => setIsAddressExpanded(!isAddressExpanded)} style={styles.viewAddressBtn}>
                <Text style={styles.viewAddressText}>View Address Details</Text>
                <Feather name={isAddressExpanded ? 'chevron-up' : 'chevron-right'} size={16} color={colors.primary} />
              </Pressable>
            </View>
            <View style={styles.etaBadge}>
              <Text style={styles.etaValue}>{etaMinutes}</Text>
              <Text style={styles.etaLabel}>mins</Text>
            </View>
          </View>

          {isAddressExpanded && (
            <View style={styles.addressAccordion}>
              <Divider />
              <View style={styles.accordionContent}>
                <LocationInputRow
                  label="Pickup"
                  address={pickupAddress}
                  dotColor={colors.statusGreen}
                  onPress={() => (onEditPickup ? onEditPickup() : navigation?.navigate('SelectLocationScreen'))}
                  showConnector
                />
                {dropAddresses.map((drop, i) => (
                  <LocationInputRow
                    key={`drop-${i}`}
                    label={`Drop ${i + 1}`}
                    address={drop}
                    dotColor={colors.onSurface}
                    onPress={() => (onEditDrop ? onEditDrop() : navigation?.navigate('SelectDropLocationScreen'))}
                    showConnector={i < dropAddresses.length - 1}
                  />
                ))}
              </View>
            </View>
          )}

          <View style={styles.loadingInfoBox}>
            <Feather name="clock" size={16} color={colors.onSurfaceVariant} />
            <Text style={styles.loadingInfoText}>
              Free <Text style={styles.loadingInfoBold}>70 mins</Text> of loading-unloading time included.
            </Text>
          </View>
        </Card>


        {/* Offers and Discounts */}
        <Text style={styles.sectionTitle}>Offers and Discounts</Text>
        <Card variant="outlined" padding="md" style={styles.offerCard}>
          <View style={styles.offerRow}>
            <View style={styles.offerIconWrapper}>
              <Feather name="tag" size={20} color={colors.statusGreen} />
            </View>
            <Text style={styles.offerText}>Apply Coupon</Text>
            <Feather name="chevron-right" size={20} color={colors.onSurfaceVariant} />
          </View>
        </Card>


        {/* Declared Value & Insurance */}
        <Card variant="outlined" padding="none" style={styles.extraServicesCard}>
          <ListRow
            title="Declared Value"
            subtitle={draft.declaredValue ?? mockBookingReview.declaredValue}
            leading={<Feather name="tag" size={20} color={colors.onSurfaceVariant} />}
            trailing={<Feather name="chevron-right" size={20} color={colors.onSurfaceVariant} />}
            onPress={() => navigation?.navigate('DeclaredValueSelectionScreen')}
          />
          <Divider />
          <ListRow
            title="Insurance"
            subtitle={draft.insured ? 'Active' : mockBookingReview.insurance}
            leading={<Feather name="shield" size={20} color={colors.onSurfaceVariant} />}
            trailing={<Feather name="chevron-right" size={20} color={colors.onSurfaceVariant} />}
            onPress={() => navigation?.navigate('GoodsInsuranceScreen')}
          />
        </Card>

        {/* Terms & Privacy */}
        <Text style={styles.termsText}>
          By booking you agree to our new <Text style={styles.linkText}>terms of service</Text> and <Text style={styles.linkText}>privacy policy</Text>
        </Text>

      </ScrollView>

      {/* Fixed Footer */}
      <View style={styles.footer}>
        <View style={styles.paymentRow}>
          <View style={styles.paymentLeft}>
            <Feather name="dollar-sign" size={20} color={colors.statusGreen} />
            <View style={styles.paymentMethodInfo}>
              <Text style={styles.paymentTitle}>Choose Payment Method</Text>
              <Pressable style={styles.paymentSelector} onPress={() => (onChangePayment ? onChangePayment() : navigation?.navigate('PaymentMethodScreen'))}>
                <Text style={styles.paymentMethodText}>{mockBookingReview.paymentMethod}</Text>
                <Feather name="chevron-down" size={16} color={colors.onSurface} />
              </Pressable>
            </View>
          </View>
          <View style={styles.paymentRight}>
            <Text style={styles.totalFareText}>{estimatedFare}</Text>
            <Text style={styles.viewBreakupText}>View Breakup</Text>
          </View>
        </View>

        <Button
          label={`Book ${vehicleName}`}
          onPress={() => {
            onConfirm?.();
            navigation?.navigate('BookingConfirmedScreen');
          }}
          variant="primary"
          size="lg"
          fullWidth
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8F9FA', // Light neutral background matching the reference
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    gap: spacing.stackGapMd,
    paddingBottom: spacing.xxxl + spacing.xxl, // Make sure we scroll past the floating footer
  },
  
  // Vehicle Card
  vehicleCardWrapper: {
    overflow: 'hidden',
  },
  vehicleCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  vehicleImage: {
    width: 60,
    height: 40,
  },
  vehicleInfo: {
    flex: 1,
  },
  vehicleName: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  viewAddressBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  viewAddressText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.primary,
    fontWeight: '600',
    marginRight: 4,
  },
  etaBadge: {
    backgroundColor: '#F3F4F6',
    borderRadius: borderRadius.sm,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  etaValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.onSurface,
  },
  etaLabel: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
  },
  addressAccordion: {
    backgroundColor: colors.surface,
  },
  accordionContent: {
    padding: spacing.md,
  },
  loadingInfoBox: {
    backgroundColor: '#F0F4F8',
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    gap: spacing.sm,
    borderBottomLeftRadius: borderRadius.md,
    borderBottomRightRadius: borderRadius.md,
    justifyContent: 'center',
  },
  loadingInfoText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
  },
  loadingInfoBold: {
    fontWeight: '700',
    color: colors.onSurface,
  },

  // Offers
  sectionTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
    marginTop: spacing.sm,
    marginBottom: -spacing.sm, // Negative margin to bring card closer
  },
  offerCard: {
    overflow: 'hidden',
  },
  offerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offerIconWrapper: {
    width: 32,
    height: 32,
    backgroundColor: '#E8F5E9',
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  offerText: {
    flex: 1,
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
  },

  // Extra Services
  extraServicesCard: {
    overflow: 'hidden',
  },

  // Terms
  termsText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 20,
  },
  linkText: {
    color: colors.primary,
    fontWeight: '600',
  },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing.marginMobile,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl, // Safe area for devices with home indicator
    ...shadows.md,
    elevation: 10,
  },
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  paymentLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  paymentMethodInfo: {
    justifyContent: 'center',
  },
  paymentTitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    marginBottom: 2,
  },
  paymentSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  paymentMethodText: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '700',
    color: colors.onSurface,
  },
  paymentRight: {
    alignItems: 'flex-end',
  },
  totalFareText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.onSurface,
    marginBottom: 2,
  },
  viewBreakupText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '600',
    color: colors.primary,
  },
});

export default ReviewBookingScreen;
