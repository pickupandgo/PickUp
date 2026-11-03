import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, type ViewStyle } from 'react-native';
import { colors, typography, spacing, borderRadius } from '../../theme';
import Icon from '../atoms/Icon';
import type { TripOffer } from '../../types/trip';
import type { LocationResult } from '../../location/types';
import { useOfferRoadRoutes } from '../../hooks/useOfferRoadRoutes';
import { offerDistances } from '../../services/trip/offerDistances';

export interface TripOfferSheetProps {
  readonly offer: TripOffer;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onExpired?: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
  readonly currentLocation?: LocationResult | null;
  readonly now?: number;
  readonly busy?: boolean;
  readonly error?: string | null;
  readonly collapsed?: boolean;
  readonly onCollapse?: () => void;
}

/** Non-modal content: the host keeps tabs and the rest of the screen interactive. */
export const TripOfferSheet: React.FC<TripOfferSheetProps> = ({
  offer, onAccept, onDecline, style, testID, currentLocation = null, now = Date.now(),
  busy = false, error, collapsed = false, onCollapse,
}) => {
  const [details, setDetails] = useState(false);
  const road = useOfferRoadRoutes(offer, currentLocation, now);
  const { pickupKm, deliveryKm } = offerDistances(offer, currentLocation, now, road);
  const valid = Number.isFinite(offer.expiresAt) && offer.expiresAt > now;
  const seconds = valid ? Math.ceil((offer.expiresAt - now) / 1000) : 0;
  const amount = offer.partnerAmount;
  return <View style={[styles.card, style]} testID={testID}>
    <Pressable style={styles.header} onPress={onCollapse} disabled={!onCollapse}
      accessibilityRole="button" accessibilityLabel={collapsed ? 'Expand incoming trip request' : 'Collapse incoming trip request'}
      accessibilityState={{ expanded: !collapsed }}>
      <Icon name="local_shipping" size={22} color={colors.navigationIcon} />
      <View style={styles.grow}>
        <Text style={styles.eyebrow}>NEW TRIP REQUEST</Text>
        <Text style={styles.secondary}>{busy ? 'Checking with server…' : valid ? `${seconds}s remaining` : 'Request expired'}</Text>
      </View>
      {onCollapse && <Icon name={collapsed ? 'expand_less' : 'expand_more'} size={24} color={colors.navigationIcon} />}
    </Pressable>
    {!collapsed && <>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} nestedScrollEnabled>
        <View>
          <Text style={styles.secondary}>Partner offer amount</Text>
          <Text style={styles.amount}>{amount !== undefined && Number.isFinite(amount) && amount >= 0
            ? `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : 'Not supplied'}</Text>
        </View>
        <View style={styles.location}>
          <Icon name="my_location" size={20} color={colors.navigationIcon} />
          <View style={styles.grow}>
            <Text style={styles.title}>{pickupKm === null ? 'Pickup road distance unavailable' : `Pickup · ${pickupKm.toFixed(1)} km · ${Math.ceil(road!.toPickup.durationSeconds / 60)} min`}</Text>
            <Text style={styles.body} numberOfLines={details ? undefined : 2}>{offer.pickupStop.address}</Text>
          </View>
        </View>
        <View style={styles.location}>
          <Icon name="location_on" size={20} color={colors.navigationIcon} />
          <View style={styles.grow}>
            <Text style={styles.title}>{deliveryKm === null ? 'Delivery road distance unavailable' : `Pickup to ${offer.dropStops.length > 1 ? 'all drops' : 'drop'} · ${deliveryKm.toFixed(1)} km · ${Math.ceil(road!.delivery.durationSeconds / 60)} min`}</Text>
            {(details ? offer.dropStops : offer.dropStops.slice(-1)).map((drop, index) =>
              <Text key={drop.id} style={styles.body} numberOfLines={details ? undefined : 2}>
                {details && offer.dropStops.length > 1 ? `${index + 1}. ` : ''}{drop.address}
              </Text>)}
            <Text style={styles.secondary}>{offer.dropStops.length} {offer.dropStops.length === 1 ? 'drop' : 'drops'} · {road ? 'Driving route' : 'Road routing unavailable'}</Text>
          </View>
        </View>
        {pickupKm === null && <Text style={styles.secondary}>A fresh, accurate location is needed for pickup distance.</Text>}
        <Text style={styles.body}>{offer.vehicleType} · {offer.weightKg === undefined ? 'Weight unavailable' : `${offer.weightKg.toLocaleString('en-IN')} kg`}</Text>
        <Text style={styles.secondary}>{offer.goodsDescription || 'Goods description not supplied'}</Text>
        <Pressable onPress={() => setDetails(value => !value)} style={styles.detailButton} accessibilityRole="button"
          accessibilityState={{ expanded: details }}><Text style={styles.title}>{details ? 'Less detail' : 'Addresses and stops'}</Text></Pressable>
        {error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
      </ScrollView>
      <View style={styles.actions}>
        <Pressable style={[styles.button, styles.decline]} onPress={onDecline} disabled={busy || !valid}
          accessibilityRole="button" accessibilityState={{ disabled: busy || !valid }}><Text style={styles.title}>Decline</Text></Pressable>
        <Pressable style={[styles.button, styles.accept, (busy || !valid) && styles.disabled]} onPress={onAccept} disabled={busy || !valid}
          accessibilityRole="button" accessibilityState={{ disabled: busy || !valid, busy }}><Text style={styles.acceptText}>{busy ? 'Please wait…' : 'Accept'}</Text></Pressable>
      </View>
    </>}
  </View>;
};
const styles = StyleSheet.create({
  card: { backgroundColor: colors.surfaceContainerLowest, borderWidth: 1, borderColor: colors.outlineSubtle,
    borderRadius: borderRadius.xl, overflow: 'hidden', flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, minHeight: 56 },
  grow: { flex: 1, minWidth: 0 },
  eyebrow: { ...typography.labelCaps, color: colors.primary },
  secondary: { ...typography.bodyMd, color: colors.onSurfaceMuted },
  body: { ...typography.bodyMd, color: colors.onSurfaceVariant },
  title: { ...typography.headlineSm, color: colors.onSurface },
  amount: { ...typography.headlineMd, color: colors.primary },
  scroll: { flexShrink: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.sm },
  location: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  detailButton: { minHeight: 48, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  button: { flex: 1, minHeight: 48, padding: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.full },
  decline: { borderWidth: 1, borderColor: colors.outlineVariant },
  accept: { backgroundColor: colors.primary },
  acceptText: { ...typography.headlineSm, color: colors.onPrimary },
  disabled: { opacity: 0.5 },
  error: { ...typography.bodyMd, color: colors.error },
});

export default TripOfferSheet;
