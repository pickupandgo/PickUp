import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDriverLocation } from '../../location';
import { incomingOffers } from '../../services/trip/incomingOfferRuntime';
import type { RootStackParamList } from '../../types/navigation';
import { TripOfferSheet } from '../organisms/TripOfferSheet';
import { floatingPanel } from '../../services/tracking/FloatingPanel';
import { TripController } from '../../services/trip/TripController';
import { AppState } from 'react-native';

export function IncomingTripOffer({ onHeight }: { onHeight: (height: number) => void }) {
  const state = useSyncExternalStore(incomingOffers.subscribe, incomingOffers.getSnapshot);
  const [now, setNow] = useState(Date.now);
  const responding = useRef(false);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const available = Math.max(0, height - insets.top - insets.bottom - 112);
  const { currentLocation } = useDriverLocation();
  useEffect(() => {
    const publish = () => floatingPanel.update(incomingOffers.getSnapshot().offer, TripController.getInstance().getTrip());
    publish();
    const offers = incomingOffers.subscribe(publish);
    const trips = TripController.getInstance().subscribe(publish);
    return () => { offers(); trips(); };
  }, []);
  useEffect(() => {
    const check = async () => {
      if (AppState.currentState !== 'active' || !incomingOffers.getSnapshot().offer) return;
      const action = await floatingPanel.takeAction();
      if (!action || action.offerId !== incomingOffers.getSnapshot().offer?.id) return;
      if (responding.current) return;
      responding.current = true;
      try {
        const trip = await incomingOffers.respond(action.action === 'accept');
        if (trip) navigation.navigate('Main', { screen: 'HomeTab', params: { screen: 'ActiveTrip', params: { tripId: trip.id } } });
      } finally { responding.current = false; }
    };
    check().catch(() => {});
    const app = AppState.addEventListener('change', next => { if (next === 'active') check().catch(() => {}); });
    return () => app.remove();
  }, [state.offer, navigation]);
  useEffect(() => {
    if (!state.offer) { onHeight(0); return; }
    setNow(Date.now());
    const timer = setInterval(() => { setNow(Date.now()); incomingOffers.expire(); }, 500);
    return () => clearInterval(timer);
  }, [state.offer, onHeight]);
  if (!state.offer) return null;
  const respond = async (accept: boolean) => {
    if (responding.current) return;
    responding.current = true;
    try {
      const trip = await incomingOffers.respond(accept);
      if (trip) navigation.navigate('Main', { screen: 'HomeTab', params: { screen: 'ActiveTrip', params: { tripId: trip.id } } });
    } finally { responding.current = false; }
  };
  return <View pointerEvents="box-none" style={[styles.host, { bottom: 56 + insets.bottom, maxHeight: Math.min(available, Math.max(available * 0.65, 180 * fontScale)) }]}
    onLayout={event => onHeight(event.nativeEvent.layout.height)}>
    <TripOfferSheet style={styles.sheet} key={state.offer.id} offer={state.offer} now={now} currentLocation={currentLocation}
      collapsed={state.collapsed} onCollapse={incomingOffers.collapse} busy={state.busy} error={state.error}
      onAccept={() => { respond(true); }} onDecline={() => { respond(false); }} testID="incoming-trip-offer" />
  </View>;
}
const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 12, alignItems: 'center', elevation: 6 },
  sheet: { width: '100%', maxWidth: 560 },
});
