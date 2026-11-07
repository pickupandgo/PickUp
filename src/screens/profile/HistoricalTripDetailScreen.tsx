import React, { useContext, useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Image, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { useBookingPayment } from '../../hooks/useBookingPayment';
import { useSelectedTrip } from '../../hooks/useSelectedTrip';
import { BookingContext } from '../../state/BookingContext';
import { getRide } from '../../api/engine';
import { getFareQuote } from '../../api/payments';
import { formatPaise, paymentLabel } from '../../utils/paymentPresentation';
import { getVehicleImage, getVehicleDisplayName } from '../../utils/vehicleAssets';
import { vehicleLabelFor } from '../../data/mockData';
import { savedCollectionPreference } from '../../state/collectionPreference';
import { APP_NAME } from '../../config/brand';
import type { Trip, Ride, FareQuote } from '../../api/types';

export interface HistoricalTripDetailScreenProps { readonly onBack?: () => void; readonly onDownloadInvoice?: () => void; readonly onNeedHelp?: () => void; }

/** Selected historical identity only; this page never changes the active booking. */
export default function HistoricalTripDetailScreen({ onBack, onDownloadInvoice, onNeedHelp, navigation, route }: HistoricalTripDetailScreenProps & { navigation?: any; route?: { params?: { trip?: Trip; tripId?: string } } }) {
  const context = useContext(BookingContext);
  const trip = useSelectedTrip(route?.params, undefined);
  const snapshot = context?.completedBooking?.trip.id === trip?.id ? context?.completedBooking : undefined;
  const knownRide = snapshot?.ride ?? (context?.ride?.id === trip?.rideId ? context?.ride : undefined);
  const [loadedRide, setLoadedRide] = useState<Ride>();
  const [quote, setQuote] = useState<FareQuote>();
  const [quoteError, setQuoteError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!trip?.rideId || knownRide) return;
    const controller = new AbortController();
    getRide(trip.rideId, controller.signal).then(value => { if (!controller.signal.aborted && value.id === trip.rideId) setLoadedRide(value); }).catch(() => {});
    return () => controller.abort();
  }, [trip?.rideId, knownRide]);
  const ride = knownRide ?? (loadedRide?.id === trip?.rideId ? loadedRide : undefined);
  useEffect(() => {
    if (!ride?.quoteId) return;
    const controller = new AbortController(); setQuote(undefined); setQuoteError(false);
    getFareQuote(ride.quoteId, controller.signal).then(value => { if (!controller.signal.aborted && value.quoteId === ride.quoteId) setQuote(value); }).catch(() => { if (!controller.signal.aborted) setQuoteError(true); });
    return () => controller.abort();
  }, [ride?.quoteId, attempt]);
  const payment = useBookingPayment(trip?.paymentBookingId ?? ride?.paymentBookingId);
  const total = payment.booking?.farePaise ?? trip?.payablePaise ?? (typeof trip?.fare === 'number' ? Math.round(trip.fare * 100) : undefined);
  const breakdown = quote?.quoteId === ride?.quoteId && (total === undefined || quote?.payablePaise === total) ? quote : undefined;
  const selected = { trip, tripId: trip?.id, paymentBookingId: trip?.paymentBookingId ?? ride?.paymentBookingId };
  const paid = payment.booking?.paymentStatus === 'PAID';
  const method = payment.booking?.paymentMethod ?? trip?.paymentMethod ?? ride?.paymentMethod;
  const preference = savedCollectionPreference(trip?.metadata?.specialInstructions ?? ride?.metadata?.specialInstructions);
  const timing = method === 'PAY_AT_PICKUP' ? 'at pickup' : method === 'PAY_AT_DELIVERY' ? 'at drop' : '';
  const choice = method === 'PREPAID_UPI' ? 'UPI payment' : `${preference ?? 'Payment'} ${timing}`.trim();
  const completed = trip?.status === 'COMPLETED', cancelled = trip?.status === 'CANCELLED';
  const phase = completed ? 'Completed' : cancelled ? 'Cancelled' : trip?.status === 'DELIVERED' ? 'Finalizing trip' : trip?.status.replace(/_/g, ' ') ?? 'Status unavailable';
  const date = trip?.completedAt ?? trip?.cancelledAt ?? trip?.createdAt;
  const reference = trip?.externalRef || trip?.id;
  const shortReference = reference && reference.length > 20 ? `${reference.slice(0, 8)}…${reference.slice(-4)}` : reference;
  const shareReference = async () => { if (reference) { try { await Share.share({ message: `${APP_NAME} trip reference: ${reference}` }); } catch { /* System share dismissed/unavailable. */ } } };
  const vehicle = trip?.vehicleType ?? ride?.vehicleType;
  const driver = snapshot?.driver ?? (context?.assignedDriver?.id === trip?.driverId ? context?.assignedDriver : undefined);
  const driverName = (trip as (Trip & { driverName?: string }) | undefined)?.driverName ?? driver?.name;
  const drops = trip?.stops?.length ? trip.stops.map(stop => ({ location: stop.location, sequence: stop.sequence, status: stop.status })) : trip?.drop ? [{ location: trip.drop, sequence: 1, status: undefined }] : [];
  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View style={styles.header}><Pressable style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Back to trips" onPress={() => onBack ? onBack() : navigation?.goBack()}><Feather name="arrow-left" size={spacing.xxl} color={colors.homeAction}/></Pressable><Text style={styles.title}>Trip details</Text></View>
    {!trip ? <View style={styles.empty}><Text style={styles.body}>Trip details are unavailable.</Text></View> : <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={[styles.statusBanner, cancelled && styles.cancelledBanner]}><Feather name={completed ? 'check-circle' : cancelled ? 'x-circle' : 'clock'} size={spacing.xxxl} color={cancelled ? colors.error : colors.homePickup}/><View style={styles.flex}><Text style={styles.sectionTitle}>{phase}</Text><Text style={styles.muted}>{date && Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString('en-IN', { day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit' }) : 'Date unavailable'}</Text></View></View>
      <Pressable style={styles.spread} accessibilityRole="button" accessibilityLabel="Share trip reference" onPress={() => void shareReference()}><Text style={styles.muted}>Trip reference</Text><View style={styles.inline}><Text style={styles.strong}>{shortReference}</Text><Feather name="share-2" size={spacing.lg} color={colors.homeAction}/></View></Pressable>
      <View style={styles.card}><Text style={styles.sectionTitle}>Route details</Text><View style={styles.addressRow}><View style={styles.pickupDot}/><View style={styles.flex}><Text style={styles.label}>PICKUP</Text><Text style={styles.address}>{trip.pickup?.address || 'Address unavailable'}</Text></View></View>
        {drops.map((drop,index) => <View style={styles.addressRow} key={drop.sequence}><View style={styles.dropDot}><Text style={styles.dropNumber}>{index+1}</Text></View><View style={styles.flex}><Text style={styles.label}>DROP{drops.length > 1 ? ` ${index+1} OF ${drops.length}` : ''}</Text><Text style={styles.address}>{drop.location.address || 'Address unavailable'}</Text>{drop.status && drop.status !== 'DELIVERED' && <Text style={styles.muted}>{drop.status.replace(/_/g,' ').toLowerCase()}</Text>}</View></View>)}
        <View style={[styles.spread, styles.divider]}><View style={styles.flex}><Text style={styles.muted}>Distance</Text><Text style={styles.strong}>{typeof trip.totalDistanceKm === 'number' ? `${trip.totalDistanceKm.toFixed(1)} km` : 'Not available'}</Text></View><View style={[styles.flex,styles.metaColumn]}><Text style={styles.muted}>Vehicle</Text><Text style={styles.strong}>{vehicle ? vehicleLabelFor(getVehicleDisplayName(vehicle)) : 'Not available'}</Text></View></View>
      </View>
      <View style={styles.card}><Text style={styles.sectionTitle}>Driver</Text><View style={styles.inline}>{vehicle && <View style={styles.avatar}><Image source={getVehicleImage(vehicle)} style={styles.vehicleImage} resizeMode="contain"/></View>}<View style={styles.flex}><Text style={styles.strong}>{driverName || 'Assigned driver'}</Text><Text style={styles.muted}>{vehicle ? vehicleLabelFor(getVehicleDisplayName(vehicle)) : 'Driver details unavailable'}</Text></View></View></View>
      <View style={styles.card}><View style={styles.spread}><Text style={styles.sectionTitle}>Payment details</Text><Text style={[styles.paymentBadge, paid && styles.paid]}>{payment.booking ? paymentLabel(payment.booking) : payment.loading ? 'Checking...' : 'Status unavailable'}</Text></View><View style={styles.method}><Feather name="credit-card" size={spacing.xl} color={colors.secondary}/><Text style={styles.body}>{choice}</Text></View>
        {breakdown ? <><View style={styles.spread}><Text style={styles.body}>Delivery fare</Text><Text style={styles.body}>{formatPaise(breakdown.deliveryFarePaise ?? breakdown.farePaise)}</Text></View>{breakdown.customerPlatformFeePaise !== undefined && <View style={styles.spread}><Text style={styles.body}>Platform fee{breakdown.customerPlatformFeeBps !== undefined ? ` (${breakdown.customerPlatformFeeBps/100}%)` : ''}</Text><Text style={styles.body}>{formatPaise(breakdown.customerPlatformFeePaise)}</Text></View>}{(breakdown.surgeChargePaise ?? 0)>0 && <View style={styles.spread}><Text style={styles.body}>Surge charge</Text><Text style={styles.body}>{formatPaise(breakdown.surgeChargePaise)}</Text></View>}{breakdown.taxPaise>0 && <View style={styles.spread}><Text style={styles.body}>Tax</Text><Text style={styles.body}>{formatPaise(breakdown.taxPaise)}</Text></View>}</> : <Text style={styles.muted}>{ride?.quoteId && !quoteError && !quote ? 'Loading fare breakdown...' : 'Detailed fare breakdown is not available.'}</Text>}
        {(quoteError || (quote && !breakdown)) && <Pressable accessibilityRole="button" accessibilityLabel="Retry fare details" onPress={() => setAttempt(value=>value+1)}><Text style={styles.strong}>Retry breakdown</Text></Pressable>}
        <View style={[styles.spread,styles.divider]}><Text style={styles.strong}>Total</Text><Text style={styles.sectionTitle}>{formatPaise(total)}</Text></View>
        {payment.error && <Pressable accessibilityRole="button" accessibilityLabel="Retry payment status" onPress={payment.refresh}><Text style={styles.muted}>{payment.error}</Text><Text style={styles.strong}>Refresh payment status</Text></Pressable>}
      </View>
      {(payment.booking || onDownloadInvoice) && <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="View receipt" onPress={() => onDownloadInvoice ? onDownloadInvoice() : navigation?.navigate('BookingStack',{screen:'DigitalReceiptScreen',params:selected})}><Feather name="file-text" size={spacing.xxl} color={colors.homeAction}/><Text style={[styles.strong,styles.flex]}>{paid ? 'View receipt' : 'View payment details'}</Text><Feather name="chevron-right" size={spacing.xl} color={colors.secondary}/></Pressable>}
      <Pressable style={styles.action} accessibilityRole="button" accessibilityLabel="Help with this trip" onPress={() => onNeedHelp ? onNeedHelp() : navigation?.navigate('MainTabs',{screen:'HelpScreen',params:{tripId:trip.id,tripReference:trip.externalRef || trip.id}})}><Feather name="help-circle" size={spacing.xxl} color={colors.homeAction}/><Text style={[styles.body,styles.flex]}>Need help with this trip?</Text><Feather name="chevron-right" size={spacing.xl} color={colors.secondary}/></Pressable>
      <Text style={styles.brand}>{APP_NAME}</Text>
    </ScrollView>}
  </SafeAreaView>;
}
const styles=StyleSheet.create({
  page:{flex:1,backgroundColor:colors.surface},flex:{flex:1,minWidth:0},header:{flexDirection:'row',alignItems:'center',gap:spacing.sm,paddingHorizontal:spacing.sm,minHeight:spacing.rowHeightStandard},iconButton:{width:spacing.rowHeightSm,height:spacing.rowHeightSm,alignItems:'center',justifyContent:'center'},title:{...typography.headlineMd,color:colors.homeAction,fontWeight:'700'},content:{padding:spacing.lg,gap:spacing.lg,paddingBottom:spacing.xxl},empty:{flex:1,padding:spacing.xxl,alignItems:'center',justifyContent:'center'},
  statusBanner:{flexDirection:'row',alignItems:'center',gap:spacing.md,padding:spacing.lg,borderRadius:borderRadius.lg,backgroundColor:colors.selectionTint},cancelledBanner:{backgroundColor:colors.errorContainer},sectionTitle:{...typography.headlineSm,color:colors.homeAction,fontWeight:'700'},strong:{...typography.bodyMd,color:colors.homeAction,fontWeight:'600'},muted:{...typography.labelSm,color:colors.secondary,marginTop:spacing.xs},body:{...typography.bodyMd,color:colors.homeAction},spread:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:spacing.md},inline:{flexDirection:'row',alignItems:'center',gap:spacing.md},
  card:{borderWidth:1,borderColor:colors.outlineHairline,borderRadius:borderRadius.xl,padding:spacing.lg,gap:spacing.lg},addressRow:{flexDirection:'row',alignItems:'flex-start',gap:spacing.md},pickupDot:{width:spacing.md,height:spacing.md,borderRadius:borderRadius.full,backgroundColor:colors.homePickup,marginHorizontal:spacing.xs,marginTop:spacing.xs},dropDot:{width:spacing.xl,height:spacing.xl,borderRadius:borderRadius.full,backgroundColor:colors.homeAction,alignItems:'center',justifyContent:'center'},dropNumber:{...typography.labelSm,color:colors.onPrimary},label:{...typography.labelCaps,color:colors.secondary,marginBottom:spacing.xs},address:{...typography.bodyMd,color:colors.homeAction,fontWeight:'600'},divider:{borderTopWidth:1,borderColor:colors.outlineHairline,paddingTop:spacing.md},metaColumn:{borderLeftWidth:1,borderColor:colors.outlineHairline,paddingLeft:spacing.md},avatar:{width:spacing.rowHeightStandard,height:spacing.rowHeightStandard,borderRadius:borderRadius.full,backgroundColor:colors.surfaceContainerLow,alignItems:'center',justifyContent:'center'},vehicleImage:{width:spacing.rowHeightSm+spacing.sm,height:spacing.rowHeightSm+spacing.sm},
  paymentBadge:{...typography.labelSm,color:colors.secondary,backgroundColor:colors.surfaceContainerLow,paddingHorizontal:spacing.sm,paddingVertical:spacing.xs,borderRadius:borderRadius.md,flexShrink:1},paid:{backgroundColor:colors.successContainer,color:colors.homePickup},method:{flexDirection:'row',alignItems:'center',gap:spacing.md,padding:spacing.md,borderRadius:borderRadius.md,backgroundColor:colors.surfaceContainerLow},action:{flexDirection:'row',alignItems:'center',gap:spacing.md,padding:spacing.lg,minHeight:spacing.rowHeightStandard,borderWidth:1,borderColor:colors.outlineHairline,borderRadius:borderRadius.lg},brand:{...typography.labelSm,color:colors.secondary,textAlign:'center'},
});
