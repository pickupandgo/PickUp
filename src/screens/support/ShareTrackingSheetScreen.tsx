import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Share, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getAuth } from '@react-native-firebase/auth';
import { colors, spacing, typography } from '../../theme';
import { useBooking } from '../../state/BookingContext';
import { useSelectedTrip } from '../../hooks/useSelectedTrip';
import Button from '../../components/atoms/Button';
export interface ShareTrackingSheetScreenProps {
  readonly onBack?: () => void;
  readonly onClose?: () => void;
  readonly onCopyLink?: () => void;
  readonly onShare?: () => void;
}
/** Shares a reference using the OS chooser. There is no public live-tracking link contract. */
export default function ShareTrackingSheetScreen({
  onBack,
  onClose,
  navigation,
  route,
}: ShareTrackingSheetScreenProps & { navigation?: any; route?: any }) {
  const context = useBooking();
  const trip = useSelectedTrip(route?.params, context.trip);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const share = async () => {
    if (!trip || locked.current || !getAuth().currentUser) return;
    const uid = getAuth().currentUser!.uid;
    locked.current = true;
    setBusy(true);
    try {
      await Share.share({
        message: `PICKUP trip reference: ${trip.externalRef || trip.id}\nStatus: ${trip.status.replace(/_/g, ' ')}\nThis is a trip reference, not a live tracking link.`,
      });
      // Opening/dismissing the chooser is not proof of delivery. Do not show a fake success.
    } catch {
      if (alive.current && getAuth().currentUser?.uid === uid)
        Alert.alert(
          'Could not open sharing',
          'Please try again. Nothing was confirmed as shared.',
        );
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() =>
          onClose ? onClose() : onBack ? onBack() : navigation?.goBack()
        }
      >
        <Text style={styles.back}>Back</Text>
      </Pressable>
      <View style={styles.content}>
        <Text style={styles.title}>Share trip reference</Text>
        <Text style={styles.body}>
          Live tracking links are not available yet. You can share this trip
          reference using your phone's share menu.
        </Text>
        {trip ? (
          <>
            <Text style={styles.body}>
              Reference: {trip.externalRef || trip.id}
            </Text>
            <Text style={styles.body}>
              Status: {trip.status.replace(/_/g, ' ')}
            </Text>
          </>
        ) : (
          <Text style={styles.body}>
            This trip is not available. Open it from your trips list and try
            again.
          </Text>
        )}
        <Text style={styles.body}>
          The shared message does not include phone numbers, addresses, payment
          details or OTPs.
        </Text>
        <Button
          label={busy ? 'Opening share menu...' : 'Share trip reference'}
          disabled={!trip || busy}
          onPress={() => {
            void share();
          }}
        />
      </View>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: spacing.lg },
  back: {
    ...typography.labelSm,
    color: colors.primary,
    paddingVertical: spacing.md,
  },
  content: { gap: spacing.lg, paddingVertical: spacing.lg },
  title: { ...typography.headlineSm, color: colors.onSurface },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
});
