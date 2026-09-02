import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { strings, mockBookingReview } from '../../data/mockData';
import { useBooking } from '../../state/BookingContext';
import TopAppBar from '../../components/organisms/TopAppBar';
import Card from '../../components/molecules/Card';
import LocationInputRow from '../../components/molecules/LocationInputRow';
import ListRow from '../../components/molecules/ListRow';
import Divider from '../../components/atoms/Divider';
import Button from '../../components/atoms/Button';

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

  // Fall back to sample data so the Gallery still renders without a booking.
  const dropAddresses = draft.drops.length
    ? draft.drops.map((d) => d.address)
    : mockBookingReview.drops;

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopAppBar
        title={strings.booking.reviewBooking}
        leadingIcon={<Text style={styles.backIcon}>←</Text>}
        onLeadingPress={() => (onBack ? onBack() : navigation?.goBack())}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Route Card */}
        <Card variant="outlined" padding="md">
          <LocationInputRow
            label="Pickup"
            address={draft.pickup?.address ?? mockBookingReview.pickup}
            dotColor={colors.statusGreen}
            onPress={() => (onEditPickup ? onEditPickup() : navigation?.navigate('SelectLocationScreen'))}
            showConnector
          />
          {dropAddresses.map((drop, i) => (
            <LocationInputRow
              key={`drop-${i}`}
              label={`Drop ${i + 1}`}
              address={drop}
              dotColor={colors.primary}
              onPress={() => (onEditDrop ? onEditDrop() : navigation?.navigate('SelectDropLocationScreen'))}
              showConnector={i < dropAddresses.length - 1}
            />
          ))}
        </Card>

        {/* Vehicle & Fare Card */}
        <Card variant="outlined" padding="none">
          <ListRow
            title="Vehicle"
            subtitle={draft.vehicleType ?? mockBookingReview.vehicleType}
            leading={<Text style={styles.itemIcon}>🚛</Text>}
            trailing={
              <Text
                style={styles.changeText}
                onPress={() => (onChangeVehicle ? onChangeVehicle() : navigation?.navigate('SelectVehicleScreen'))}
              >
                Change
              </Text>
            }
          />
          <Divider />
          <ListRow
            title="Estimated Fare"
            subtitle={
              estimate
                ? `${estimate.distanceKm} km • about ${estimate.durationMin} min`
                : `${mockBookingReview.distance} • ${mockBookingReview.estimatedTime}`
            }
            leading={<Text style={styles.itemIcon}>💰</Text>}
            trailing={
              <Text style={styles.fareText}>
                {estimate ? `₹ ${estimate.fare}` : mockBookingReview.estimatedFare}
              </Text>
            }
          />
          <Divider />
          <ListRow
            title="Payment"
            subtitle={mockBookingReview.paymentMethod}
            leading={<Text style={styles.itemIcon}>💳</Text>}
            trailing={
              <Text
                style={styles.changeText}
                onPress={() => (onChangePayment ? onChangePayment() : navigation?.navigate('PaymentMethodScreen'))}
              >
                Change
              </Text>
            }
          />
        </Card>

        {/* Optional: Declared Value / Insurance */}
        <Card variant="outlined" padding="none">
          <ListRow
            title="Declared Value"
            subtitle={mockBookingReview.declaredValue}
            leading={<Text style={styles.itemIcon}>🏷️</Text>}
            trailing={<Text style={styles.chevron}>›</Text>}
            onPress={() => navigation?.navigate('DeclaredValueSelectionScreen')}
          />
          <Divider />
          <ListRow
            title="Insurance"
            subtitle={mockBookingReview.insurance}
            leading={<Text style={styles.itemIcon}>🛡️</Text>}
            trailing={<Text style={styles.chevron}>›</Text>}
            onPress={() => navigation?.navigate('GoodsInsuranceScreen')}
          />
        </Card>
      </ScrollView>

      {/* Confirm CTA */}
      <View style={styles.footer}>
        <Button
          label="Confirm Booking"
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
    backgroundColor: colors.background,
  },
  backIcon: {
    fontSize: 22,
    color: colors.onSurface,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    gap: spacing.stackGapMd,
    paddingBottom: spacing.xxxl + spacing.xxl,
  },
  itemIcon: { fontSize: 20 },
  changeText: {
    fontSize: typography.bodyMd.fontSize,
    fontWeight: '600',
    color: colors.primary,
    fontFamily: typography.bodyMd.fontFamily,
  },
  fareText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  chevron: {
    fontSize: 20,
    color: colors.onSurfaceVariant,
  },
  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
  },
});

export default ReviewBookingScreen;
