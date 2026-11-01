import React from 'react';
import UnavailableFeature from '../../components/organisms/UnavailableFeature';
import { useBooking } from '../../state/BookingContext';
import { useSelectedTrip } from '../../hooks/useSelectedTrip';
export interface CallDriverScreenProps {
  readonly driverName?: string;
  readonly vehicleInfo?: string;
  readonly pickupLocation?: string;
  readonly onEndCall?: () => void;
  readonly onBack?: () => void;
}
export default function CallDriverScreen({
  onBack,
  navigation,
  route,
}: CallDriverScreenProps & { navigation?: any; route?: any }) {
  const context = useBooking();
  const selected = useSelectedTrip(route?.params, context.trip);
  const explicit =
    !!route?.params &&
    ['trip', 'tripId', 'paymentBookingId', 'bookingId'].some(
      (key) => key in route.params,
    );
  const bookingId =
    selected?.paymentBookingId ??
    (!explicit ? context.ride?.paymentBookingId : undefined);
  return (
    <UnavailableFeature
      title="Driver calling unavailable"
      message="Phone calling is not available in this version. No call has been placed. You can use driver chat for an assigned booking."
      onBack={() => (onBack ? onBack() : navigation?.goBack())}
      actionLabel={bookingId ? 'Open driver chat' : undefined}
      onAction={
        bookingId
          ? () => navigation?.navigate('ActiveTripChatScreen', { bookingId })
          : undefined
      }
    />
  );
}
