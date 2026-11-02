import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Image, Pressable, Animated, ActivityIndicator, Easing, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { mockVehicleTypes, vehicleLabelFor, vehicleCategoryFor } from '../../data/mockData';
import { getVehicleImage } from '../../utils/vehicleAssets';
import { useBooking } from '../../state/BookingContext';
import { useQuoteValidity } from '../../hooks/useQuoteValidity';
import { useVehiclePreview } from '../../hooks/useVehiclePreview';
import { useSearchProgress } from '../../hooks/useSearchProgress';
import { useBookingSearch } from '../../hooks/useBookingSearch';
import { useBookingFareQuote } from '../../hooks/useBookingFareQuote';
import { quoteMatchesDraft } from '../../state/quoteValidation';
import { isQuoteBookable } from '../../api/payments';
import MapCanvas, { type MapMarker } from '../../components/map/MapCanvas';
import { useRoadRoute } from '../../hooks/useRoute';
import Button from '../../components/atoms/Button';

export interface ReviewBookingScreenProps {
  readonly onBack?: () => void;
  readonly onConfirm?: () => void;
  readonly onEditPickup?: () => void;
  readonly onEditDrop?: () => void;
  readonly onChangeVehicle?: () => void;
}
const money = (paise: number) => `\u20B9${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const fareMoney = (paise: number) => `\u20B9${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export default function ReviewBookingScreen({ navigation, onBack, onConfirm, onChangeVehicle, route }: ReviewBookingScreenProps & { navigation?: any; route?: any }) {
  const { draft, ride, trip, setPaymentMethod, setCollectionPreference } = useBooking();
  const { height } = useWindowDimensions();
  const [submitting, setSubmitting] = useState(false);
  const [finding, setFinding] = useState(() => route?.params?.searchMode === true);
  const search = useBookingSearch(finding, navigation, route?.params?.retrySearch === true);
  const responseProgress = useSearchProgress(search.observation, finding && !search.failure && !search.noDrivers && !search.leaving);
  const searchVehicleType = ride?.vehicleType ?? draft.vehicleType;
  const preview = useVehiclePreview(draft.pickup, vehicleCategoryFor(finding ? searchVehicleType : draft.vehicleType), !search.failure && !search.noDrivers && !search.leaving && (!finding || !ride || ['REQUESTED', 'PENDING_REGISTRATION'].includes(ride.status)));
  const previewMarkers = useMemo<readonly MapMarker[]>(() => preview.vehicles.map(vehicle => ({ id: `search-preview-${vehicle.vehicleCategory}-${vehicle.key}`, kind: 'nearby', coordinate: vehicle, vehicleType: vehicle.vehicleCategory, preview: true })), [preview.vehicles]);
  const [scanWidth, setScanWidth] = useState(0);
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!finding || search.failure || search.noDrivers || search.leaving) return;
    scan.setValue(0);
    const animation = Animated.loop(Animated.timing(scan, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: true }));
    animation.start(); return () => animation.stop();
  }, [finding, search.failure, search.noDrivers, search.leaving, scan]);
  const locked = useRef(false);
  const latest = useRef(draft); latest.current = draft;
  useEffect(() => navigation?.addListener?.('focus', () => { if (!finding) { locked.current = false; setSubmitting(false); } }), [navigation, finding]);
  const fare = useBookingFareQuote(!finding);
  const quote = draft.quote;
  const timeValid = useQuoteValidity(quote);
  const valid = Boolean(quote && timeValid && quoteMatchesDraft(quote, draft));
  const canBook = valid && Boolean(draft.paymentMethod) && !fare.loading && !submitting;
  const displayedVehicle = finding ? searchVehicleType : draft.vehicleType;
  const name = vehicleLabelFor(displayedVehicle);
  const vehicle = mockVehicleTypes.find(v => v.name === displayedVehicle || v.category === displayedVehicle || v.id === displayedVehicle);
  const preference = draft.collectionPreference ?? 'CASH';
  const pickupPay = draft.paymentMethod === 'PAY_AT_PICKUP';
  const destination = draft.drops[draft.drops.length - 1];
  const road = useRoadRoute(draft.pickup, destination, draft.drops.slice(0, -1));
  const markers = useMemo<readonly MapMarker[]>(() => [
    ...(draft.pickup ? [{ id: 'pickup', kind: 'pickup' as const, coordinate: draft.pickup, title: 'Pickup' }] : []),
    ...draft.drops.map((drop, i) => ({ id: `drop-${i}`, kind: 'drop' as const, coordinate: drop, title: `Drop ${i + 1}`, stopNumber: i + 1 })),
  ], [draft.pickup, draft.drops]);
  const confirm = () => {
    const current = latest.current;
    if (!canBook || locked.current || !current.quote || !current.paymentMethod || !isQuoteBookable(current.quote) || !quoteMatchesDraft(current.quote, current)) return;
    locked.current = true; setSubmitting(true);
    try { onConfirm?.(); setFinding(true); }
    catch (error) { if (!finding) { locked.current = false; setSubmitting(false); } throw error; }
  };
  const changeVehicle = () => {
    if (onChangeVehicle) onChangeVehicle();
    else if (navigation?.popTo) navigation.popTo('SelectVehicleScreen', { returnToReview: true });
    else navigation?.navigate('SelectVehicleScreen', { returnToReview: true });
  };
  return <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
    <View>
      <MapCanvas style={{ height: Math.max(180, Math.min(finding ? 620 : 370, height * (finding ? search.noDrivers ? 0.5 : 0.65 : height < 720 ? 0.36 : 0.43))) }} appearance="home" markers={[...markers, ...previewMarkers]} fitToMarkers={markers.length > 0} fitRouteOnly
        contentInsets={{ top: spacing.rowHeightStandard + spacing.md, bottom: spacing.xl }} polyline={road.polyline} routeStatus={road.status} onRetryRoute={road.retry} />
      <Pressable style={styles.back} accessibilityRole="button" accessibilityLabel="Back" onPress={() => finding ? search.requestBack() : onBack ? onBack() : navigation?.goBack()}><Feather name="arrow-left" size={spacing.xl} color={colors.homeAction} /></Pressable>
      <View style={styles.titlePill}><Text style={styles.title}>{finding ? search.noDrivers ? 'Your booking' : 'Finding driver' : 'Review booking'}</Text></View>

    </View>
    <View style={styles.sheet}>
      {finding && !search.failure && !search.noDrivers && !search.leaving && <View style={styles.scanTrack} onLayout={event => setScanWidth(event.nativeEvent.layout.width)} accessibilityLabel="Searching for a driver"><Animated.View style={[styles.scanSegment, { width: scanWidth * 0.3, transform: [{ translateX: scan.interpolate({ inputRange: [0, 1], outputRange: [scanWidth * 0.5, scanWidth] }) }] }]} /></View>}
      <View style={styles.handle} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.vehicleCard, finding && !search.noDrivers && styles.searchVehicleCard]}>
          {finding && !search.noDrivers && responseProgress && <View pointerEvents="none" style={[styles.cardProgressTint, { width: `${responseProgress.fraction * 100}%` }]} />}
          <Image source={getVehicleImage(displayedVehicle)} style={styles.vehicleImage} resizeMode="contain" />
          <View style={styles.flex}><View style={styles.vehicleTitleRow}><Text style={styles.vehicleName} numberOfLines={1}>{name}</Text><Text style={styles.badge}>SELECTED</Text></View><Text style={styles.secondary}>{vehicle?.capacity ?? 'Selected vehicle'}</Text></View>
          <View style={styles.priceColumn}><Text style={styles.price}>{finding ? quote ? money(quote.payablePaise) : trip?.fare != null ? money(trip.fare * 100) : ride?.fare != null ? money(ride.fare * 100) : '\u2014' : fare.loading ? '...' : valid && quote ? money(quote.payablePaise) : '\u2014'}</Text>{!finding && <Pressable style={styles.smallAction} accessibilityRole="button" accessibilityLabel="Change vehicle" onPress={changeVehicle}><Text style={styles.link}>Change</Text></Pressable>}</View>
          {finding && !search.failure && !search.noDrivers && !search.leaving && <View style={styles.responseProgress}>
            <View style={styles.responseTrack}>{responseProgress ? <View testID="driver-response-progress" style={[styles.responseFill, { width: `${responseProgress.fraction * 100}%` }]} /> : <Animated.View style={[styles.responseFill, { width: scanWidth * 0.3, transform: [{ translateX: scan.interpolate({ inputRange: [0, 1], outputRange: [scanWidth * 0.5, scanWidth] }) }] }]} />}</View>
            <View style={styles.spread}><Text style={styles.responseCaption}>{responseProgress ? responseProgress.remainingSeconds > 0 ? 'Waiting for driver response' : 'Checking next driver' : 'Searching nearby drivers'}</Text><Text style={styles.responseCaption}>{responseProgress && responseProgress.remainingSeconds > 0 ? `${Math.floor(responseProgress.remainingSeconds / 60).toString().padStart(2, '0')}:${(responseProgress.remainingSeconds % 60).toString().padStart(2, '0')} response window` : 'Live search'}</Text></View>
          </View>}
        </View>
        {finding && preview.status === 'error' && <Pressable accessibilityRole="button" accessibilityLabel="Retry live vehicle preview" onPress={preview.refresh}><Text style={styles.responseCaption}>Live vehicle preview unavailable. Retry</Text></Pressable>}
        {!finding && <>
        {(fare.error || !valid) && <View style={styles.notice}><Text style={styles.noticeText}>{fare.loading ? 'Updating fare...' : fare.error || (quote ? 'Fare expired or changed. Refresh before booking.' : 'Getting your fare...')}</Text>{!fare.loading && <Pressable accessibilityRole="button" accessibilityLabel="Refresh fare" onPress={() => void fare.refresh()} style={styles.smallAction}><Text style={styles.link}>Retry</Text></Pressable>}</View>}
        {quote && <View style={styles.breakdown} accessibilityLabel="Fare details">
          <Text style={styles.fareTitle}>Fare details</Text>
          <View style={styles.spread}><Text style={styles.fareLabel}>Delivery fare</Text><Text style={styles.fareAmount}>{fareMoney(quote.deliveryFarePaise ?? quote.farePaise)}</Text></View>
          {quote.customerPlatformFeePaise !== undefined && <View style={styles.spread}><Text style={styles.fareLabel}>Platform fee{quote.customerPlatformFeeBps !== undefined ? ` (${quote.customerPlatformFeeBps / 100}%)` : ''}</Text><Text style={styles.fareAmount}>{fareMoney(quote.customerPlatformFeePaise)}</Text></View>}
          {(quote.surgeChargePaise ?? 0) > 0 && <View style={styles.spread}><Text style={styles.fareLabel}>Surge charge</Text><Text style={styles.fareAmount}>{fareMoney(quote.surgeChargePaise!)}</Text></View>}
          {quote.taxPaise > 0 && <View style={styles.spread}><Text style={styles.fareLabel}>Tax</Text><Text style={styles.fareAmount}>{fareMoney(quote.taxPaise)}</Text></View>}
          <View style={styles.fareTotal}><Text style={styles.fareTotalLabel}>Total</Text><Text style={styles.fareTotalLabel}>{fareMoney(quote.payablePaise)}</Text></View>
        </View>}
        <View style={styles.extras}>
          <Pressable style={styles.extra} accessibilityRole="button" accessibilityLabel="Edit declared value" onPress={() => navigation?.navigate('DeclaredValueSelectionScreen')}><Feather name="shield" size={spacing.xl} color={colors.homeAction} /><View style={styles.flex}><Text style={styles.body}>Declared value</Text><Text style={styles.secondary}>{draft.declaredValue ? `\u20B9${Number(draft.declaredValue.replace(/,/g, '')).toLocaleString('en-IN')}` : 'Not provided'}</Text></View><Feather name="chevron-right" size={spacing.lg} color={colors.homeAction} /></Pressable>
          <View style={styles.verticalLine} />
          <Pressable style={styles.extra} accessibilityRole="button" accessibilityLabel="Insurance information" onPress={() => navigation?.navigate('GoodsInsuranceScreen', { returnToReview: true })}><Feather name="umbrella" size={spacing.xl} color={colors.homeAction} /><View style={styles.flex}><Text style={styles.body}>Insurance</Text><Text style={styles.secondary}>Not included</Text></View><Feather name="chevron-right" size={spacing.lg} color={colors.homeAction} /></Pressable>
        </View>
        <Text style={styles.itemTitle}>Payment method</Text>
        <View style={styles.options}>{(['CASH', 'UPI'] as const).map(option => <Pressable key={option} style={[styles.option, preference === option && styles.optionSelected]} accessibilityRole="radio" accessibilityLabel={option === 'CASH' ? 'Cash' : 'UPI'} accessibilityState={{ selected: preference === option }} onPress={() => setCollectionPreference(option)}>{option === 'CASH' ? <View style={styles.cashIcon}><Feather name="dollar-sign" size={spacing.md} color={colors.paymentGreen} /></View> : <View style={styles.upiIcon}><View style={[styles.upiTriangle, styles.upiOrange]} /><View style={[styles.upiTriangle, styles.upiGreen]} /></View>}<Text style={styles.optionText}>{option === 'CASH' ? 'Cash' : 'UPI'}</Text>{preference === option ? <View style={styles.selectedCheck}><Feather name="check" size={spacing.md} color={colors.onPrimary} /></View> : <Feather name="circle" size={spacing.lg} color={colors.outlineVariant} />}</Pressable>)}</View>
        <View style={styles.spread}><View style={styles.payLabel}><Feather name="credit-card" size={spacing.xl} color={colors.homeAction} /><Text style={styles.itemTitle}>Pay at</Text></View><View style={styles.segment}>{([{ id: 'PAY_AT_PICKUP', label: 'Pickup' }, { id: 'PAY_AT_DELIVERY', label: 'Drop' }] as const).map(option => <Pressable key={option.id} style={[styles.segmentOption, draft.paymentMethod === option.id && styles.segmentSelected]} accessibilityRole="radio" accessibilityLabel={`Pay at ${option.label.toLowerCase()}`} accessibilityState={{ selected: draft.paymentMethod === option.id }} onPress={() => setPaymentMethod(option.id)}><Text style={[styles.segmentText, draft.paymentMethod === option.id && styles.segmentTextSelected]}>{option.label}</Text></Pressable>)}</View></View>
        <Text style={styles.helper}>{pickupPay ? 'Sender pays the driver at pickup.' : draft.drops.length > 1 ? 'Each receiver pays at their drop.' : 'Receiver pays the driver at delivery.'}</Text>
        </>}
        {finding && !search.noDrivers && <View style={styles.searchMessage}><Text style={styles.searchCaption} accessibilityLiveRegion="polite">{search.failure || 'Looking for a driver for your route'}</Text>{search.failure && <Button label="Retry booking recovery" onPress={search.retry} variant="outline" fullWidth />}</View>}
        {finding && search.noDrivers && <View style={styles.noDriverMessage}>
          <View style={styles.resultIcon}><Feather name="search" size={spacing.xxl} color={colors.homeAction} /></View>
          <Text style={styles.resultTitle}>No driver found yet</Text>
          <Text style={styles.resultSubtitle}>Try again or choose another vehicle for your delivery.</Text>
          {search.actionError && <Text style={styles.resultError} accessibilityLiveRegion="polite">{search.actionError}</Text>}
        </View>}
      </ScrollView>
      {finding && search.noDrivers ? <View style={styles.resultFooter}>
        <Button label="Try again" icon={<Feather name="refresh-cw" size={spacing.xl} color={colors.onPrimary} />} onPress={search.retry} disabled={search.leaving} fullWidth style={styles.bookButton} />
        <Button label="Change vehicle" icon={<Feather name="truck" size={spacing.xl} color={colors.homeAction} />} onPress={() => void search.leave('vehicle')} disabled={search.leaving} variant="outline" fullWidth style={styles.changeVehicleButton} />
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" disabled={search.leaving} onPress={() => void search.leave('home')} style={styles.homeLink}>{search.leaving ? <ActivityIndicator size="small" color={colors.homeAction} /> : <Text style={styles.homeLinkText}>Back to Home</Text>}</Pressable>
      </View> : finding ? <View style={styles.footer}><Button label={search.failure ? 'Search paused' : 'Finding driver...'} icon={!search.failure ? <ActivityIndicator color={colors.onPrimary} size="small" /> : undefined} onPress={() => {}} disabled fullWidth style={styles.findButton} disabledStyle={styles.findDisabled} /><Text style={styles.terms}>{search.failure ? 'Your booking reference is retained. Retry to check its status.' : 'Please keep this screen open'}</Text></View> : <View style={styles.footer}><Button label={`Book ${name.split(' /')[0]}`} trailing={<View style={styles.bookTrailing}><Text style={styles.bookAmount}>{valid && quote ? money(quote.payablePaise) : '\u2014'}</Text><Feather name="arrow-right" size={spacing.xl} color={colors.onPrimary} /></View>} onPress={confirm} disabled={!canBook} loading={submitting} fullWidth style={styles.bookButton} /><Text style={styles.terms}>By booking, you agree to our <Text style={styles.termsStrong}>Terms of Service and Safety Guidelines.</Text></Text></View>}
    </View>

  </SafeAreaView>;
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  back: { position: 'absolute', top: spacing.sm, left: spacing.lg, width: spacing.rowHeightSm + spacing.xs, height: spacing.rowHeightSm + spacing.xs, alignItems: 'center', justifyContent: 'center', borderRadius: borderRadius.full, backgroundColor: colors.surface, ...shadows.card },
  titlePill: { position: 'absolute', top: spacing.sm, right: spacing.lg, paddingHorizontal: spacing.md, minHeight: spacing.rowHeightSm + spacing.xs, justifyContent: 'center', borderRadius: borderRadius.full, backgroundColor: colors.surface, ...shadows.card },
  title: { ...typography.headlineSm, color: colors.homeAction },
  noDriverMessage: { alignItems: 'center', paddingTop: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  resultIcon: { width: spacing.rowHeightStandard, height: spacing.rowHeightStandard, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerLow, marginBottom: spacing.xs },
  resultTitle: { ...typography.headlineMd, fontWeight: '700', color: colors.homeAction, textAlign: 'center' },
  resultSubtitle: { ...typography.bodyMd, color: colors.secondary, textAlign: 'center', paddingHorizontal: spacing.lg },
  resultError: { ...typography.labelSm, color: colors.error, textAlign: 'center' },
  changeVehicleButton: { borderColor: colors.homeAction },
  resultFooter: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  homeLink: { minHeight: spacing.rowHeightSm + spacing.xs, alignItems: 'center', justifyContent: 'center' },
  homeLinkText: { ...typography.bodyMd, fontWeight: '600', color: colors.homeAction },
  searchVehicleCard: { paddingBottom: spacing.rowHeightStandard, overflow: 'hidden' },
  cardProgressTint: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.selectionTint },
  responseProgress: { position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.sm, gap: spacing.xs },
  responseTrack: { height: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.outlineHairline, overflow: 'hidden' },
  responseFill: { height: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.homePickup },
  responseCaption: { ...typography.labelSm, fontSize: typography.labelSm.fontSize - 2, color: colors.secondary },
  scanTrack: { height: spacing.xs, backgroundColor: colors.outlineHairline, overflow: 'hidden', marginHorizontal: spacing.lg, borderRadius: borderRadius.full, marginTop: spacing.sm },
  scanSegment: { height: spacing.xs, borderRadius: borderRadius.full, backgroundColor: colors.homeAction },
  searchMessage: { paddingVertical: spacing.md, gap: spacing.sm },
  searchCaption: { ...typography.bodyMd, color: colors.secondary, textAlign: 'center' },
  findButton: { minHeight: spacing.rowHeightStandard, backgroundColor: colors.secondary },
  findDisabled: { opacity: 1, backgroundColor: colors.secondary },
  sheet: { flex: 1, backgroundColor: colors.surface, borderTopLeftRadius: borderRadius.xxl, borderTopRightRadius: borderRadius.xxl },
  handle: { width: spacing.xxxl, height: spacing.xs, backgroundColor: colors.outlineVariant, borderRadius: borderRadius.full, alignSelf: 'center', marginVertical: spacing.sm },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  vehicleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  vehicleCard: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md, borderWidth: 1, borderColor: colors.homeAction, borderRadius: borderRadius.lg },
  vehicleImage: { width: spacing.rowHeightStandard, height: spacing.rowHeightStandard },
  vehicleName: { ...typography.bodyMd, flexShrink: 1, color: colors.homeAction, fontWeight: '700' },
  secondary: { ...typography.labelSm, color: colors.secondary, marginTop: spacing.xs },
  badge: { ...typography.labelSm, fontSize: typography.labelSm.fontSize - 3, lineHeight: spacing.md, fontWeight: '700', color: colors.onSuccessContainer, backgroundColor: colors.successContainer, paddingHorizontal: spacing.xs, borderRadius: borderRadius.sm, alignSelf: 'center' },
  priceColumn: { alignItems: 'flex-end', flexShrink: 1 },
  price: { ...typography.bodyLg, fontWeight: '700', color: colors.homeAction },
  smallAction: { minHeight: spacing.xxl, justifyContent: 'center', paddingHorizontal: spacing.xs },
  link: { ...typography.labelSm, color: colors.homeAction, fontWeight: '600' },
  itemTitle: { ...typography.bodyMd, color: colors.homeAction, fontWeight: '600' },
  body: { ...typography.bodyMd, color: colors.homeAction },
  breakdown: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.lg, padding: spacing.md, gap: spacing.sm },
  fareTitle: { ...typography.headlineSm, fontWeight: '700', color: colors.homeAction, marginBottom: spacing.xs },
  fareLabel: { ...typography.bodyMd, color: colors.secondary },
  fareAmount: { ...typography.bodyMd, color: colors.homeAction },
  fareTotal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.sm, marginTop: spacing.xs, borderTopWidth: 1, borderColor: colors.outlineHairline },
  fareTotalLabel: { ...typography.bodyLg, fontWeight: '700', color: colors.homeAction },
  spread: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  extras: { flexDirection: 'row', paddingVertical: spacing.sm, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.outlineHairline, gap: spacing.sm },
  extra: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: spacing.rowHeightSm },
  verticalLine: { width: 1, backgroundColor: colors.outlineHairline },
  options: { flexDirection: 'row', gap: spacing.sm },
  option: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, borderWidth: 1, borderColor: colors.outlineHairline, borderRadius: borderRadius.md, padding: spacing.sm, minHeight: spacing.rowHeightSm + spacing.xs },
  optionSelected: { borderColor: colors.homeAction, backgroundColor: colors.surfaceBright },
  optionText: { ...typography.bodyMd, fontWeight: '600', color: colors.homeAction, flex: 1 },
  payLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  segment: { flexDirection: 'row', borderRadius: borderRadius.full, backgroundColor: colors.surfaceContainerLow, padding: spacing.xs },
  segmentOption: { minHeight: spacing.xxxl, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, justifyContent: 'center' },
  segmentSelected: { backgroundColor: colors.homeAction },
  segmentText: { ...typography.bodyMd, fontWeight: '600', color: colors.secondary },
  segmentTextSelected: { color: colors.onPrimary },
  helper: { ...typography.labelSm, fontSize: typography.labelSm.fontSize - 2, textAlign: 'right', color: colors.secondary },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: 1, borderColor: colors.outlineHairline, gap: spacing.sm },
  bookButton: { backgroundColor: colors.reviewAction, minHeight: spacing.rowHeightSm + spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: spacing.xl },
  bookTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  bookAmount: { ...typography.bodyLg, fontWeight: '700', color: colors.onPrimary },
  termsStrong: { color: colors.homeAction, fontWeight: '500' },
  selectedCheck: { width: spacing.lg, height: spacing.lg, borderRadius: borderRadius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paymentGreen },
  cashIcon: { width: spacing.xxl, height: spacing.lg, borderRadius: borderRadius.xs, borderWidth: 2, borderColor: colors.paymentGreen, alignItems: 'center', justifyContent: 'center' },
  upiIcon: { width: spacing.xxl, height: spacing.xxl, flexDirection: 'row', alignItems: 'center', transform: [{ skewX: '-18deg' }] },
  upiTriangle: { width: 0, height: 0, borderTopWidth: spacing.md, borderBottomWidth: spacing.md, borderLeftWidth: spacing.md, borderTopColor: colors.transparent, borderBottomColor: colors.transparent },
  upiOrange: { borderLeftColor: colors.paymentOrange },
  upiGreen: { borderLeftColor: colors.paymentGreen, marginLeft: -spacing.xs },
  terms: { ...typography.labelSm, fontSize: typography.labelSm.fontSize - 2, color: colors.secondary, textAlign: 'center' },
  notice: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceContainerLow, padding: spacing.sm, borderRadius: borderRadius.md },
  noticeText: { ...typography.labelSm, color: colors.secondary, flex: 1 },
});
