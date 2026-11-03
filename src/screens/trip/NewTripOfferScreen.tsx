import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../../theme';
import { TripOfferSheet } from '../../components/organisms/TripOfferSheet';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { useDriverLocation } from '../../location';
import { incomingOffers } from '../../services/trip/incomingOfferRuntime';
import type { HomeScreenProps } from '../../types/navigation';

export interface NewTripOfferScreenProps {
  readonly navigation: HomeScreenProps<'TripOffer'>['navigation'];
  readonly route: HomeScreenProps<'TripOffer'>['route'];
  readonly testID?: string;
}
/** Compatibility for an already-open legacy route. New offers never navigate here.
 * Route params are not evidence of a valid request; use the live authenticated inbox.
 */
export function NewTripOfferScreen({ navigation, testID }: NewTripOfferScreenProps) {
  const state = useSyncExternalStore(incomingOffers.subscribe, incomingOffers.getSnapshot);
  const { currentLocation } = useDriverLocation();
  const [now, setNow] = useState(Date.now);
  const submitting = useRef(false);
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); incomingOffers.expire(); }, 500);
    return () => clearInterval(timer);
  }, []);
  const respond = async (accept: boolean) => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const trip = await incomingOffers.respond(accept);
      if (trip) navigation.navigate('ActiveTrip', { tripId: trip.id });
    } finally { submitting.current = false; }
  };
  return <SafeAreaView style={styles.root} testID={testID}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Incoming requests</Text>
      {state.offer ? <TripOfferSheet offer={state.offer} now={now} busy={state.busy} error={state.error} currentLocation={currentLocation}
        onAccept={() => { respond(true); }} onDecline={() => { respond(false); }} />
        : <Text style={styles.body}>No pending request. New requests appear above your tabs.</Text>}
      <SecondaryButton label="Back to dashboard" onPress={() => navigation.popToTop()} />
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.containerPadding, gap: spacing.md },
  title: { ...typography.headlineMd, color: colors.onSurface },
  body: { ...typography.bodyMd, color: colors.onSurfaceMuted },
});
export default NewTripOfferScreen;
