import { APP_NAME } from '../../config/brand';
import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  RefreshControl,
  Image,
  Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import { getCustomerHistory } from '../../api/engine';
import { BookingContext } from '../../state/BookingContext';
import Button from '../../components/atoms/Button';
import type { Trip } from '../../api/types';
import { getVehicleImage, getVehicleDisplayName } from '../../utils/vehicleAssets';
import { vehicleLabelFor } from '../../data/mockData';
import { formatPaise } from '../../utils/paymentPresentation';
import { savedCollectionPreference } from '../../state/collectionPreference';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { TripHistorySkeleton, useSkeletonVisibility } from '../../components/skeleton';

export interface TripHistoryScreenProps {
  readonly onTripSelect?: (trip: Trip) => void;
  readonly onBookRide?: () => void;
  readonly onRetry?: () => void;
  readonly customerId?: string;
  readonly initialTrips?: Trip[];
  readonly navigation?: any;
}

const TripHistoryScreen: React.FC<TripHistoryScreenProps> = (props) => {
  const booking = useContext(BookingContext);
  const owner = props.customerId ?? booking?.customerId;
  return <AccountTripHistoryScreen key={owner ?? 'signed-out'} {...props} />;
};

const AccountTripHistoryScreen: React.FC<TripHistoryScreenProps> = ({
  onTripSelect,
  onBookRide,
  onRetry,
  customerId: customerIdProp,
  initialTrips,
  navigation,
}) => {
  const [filter, setFilter] = useState<'All trips' | 'Completed' | 'Cancelled'>('All trips');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const booking = useContext(BookingContext);
  const effectiveCustomerId = customerIdProp ?? booking?.customerId;

  const [trips, setTrips] = useState<Trip[]>(initialTrips ?? []);
  const [loading, setLoading] = useState<boolean>(initialTrips === undefined && Boolean(effectiveCustomerId));
  const [error, setError] = useState<string | null>(null);

  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const TRIPS_CACHE_KEY = `pickup.trips.${effectiveCustomerId ?? 'guest'}`;

  // Account-specific cache read: immediately render cached data if available
  useEffect(() => {
    if (initialTrips !== undefined || !effectiveCustomerId) return;
    let isMounted = true;
    AsyncStorage.getItem(TRIPS_CACHE_KEY)
      .then((raw) => {
        if (!isMounted || !raw || requestRef.current) return;
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTrips(parsed);
          }
        } catch {
          // ignore cache parse error
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [TRIPS_CACHE_KEY, effectiveCustomerId, initialTrips]);

  const fetchTrips = useCallback(async () => {
    if (!effectiveCustomerId) {
      setError('Please sign in to view your trip history.');
      setLoading(false);
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomerHistory(effectiveCustomerId, controller.signal);
      if (controller.signal.aborted || requestRef.current !== controller) return;
      const safeData = Array.isArray(data) ? data : [];
      setTrips(safeData);
      AsyncStorage.setItem(TRIPS_CACHE_KEY, JSON.stringify(safeData)).catch(() => {});
    } catch (err: any) {
      if (controller.signal.aborted || requestRef.current !== controller) return;
      const message =
        err?.userMessage ||
        err?.message ||
        'Failed to load trip history. Please check your connection and try again.';
      setError(message);
    } finally {
      if (!controller.signal.aborted && requestRef.current === controller) setLoading(false);
    }
  }, [TRIPS_CACHE_KEY, effectiveCustomerId]);

  const showSkeleton = useSkeletonVisibility({
    isLoading: loading,
    hasData: trips.length > 0,
    isError: Boolean(error),
  });

  useEffect(() => {
    if (initialTrips !== undefined) return;
    fetchTrips();
  }, [fetchTrips, initialTrips]);

  const handleRetry = () => {
    onRetry?.();
    fetchTrips();
  };

  const handleBookRide = () => {
    if (onBookRide) {
      onBookRide();
      return;
    }
    try {
      booking?.startNewBooking?.();
    } catch {
      // safe fallback if outside provider
    }
    if (navigation?.navigate) {
      navigation.navigate('BookingStack', { screen: 'AddressSearchScreen' });
    }
  };

  useEffect(() => {
    if (initialTrips !== undefined) return;
    return navigation?.addListener?.('focus', () => { void fetchTrips(); });
  }, [navigation, initialTrips, fetchTrips]);
  const visibleTrips = trips.filter(trip => filter === 'All trips' || trip.status === (filter === 'Completed' ? 'COMPLETED' : 'CANCELLED')).sort((a,b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  const month = (date: string) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }).toUpperCase() : 'PREVIOUS TRIPS';
  const dateLabel = (date: string) => Number.isFinite(Date.parse(date)) ? new Date(date).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Date unavailable';
  const paymentChoice = (trip: Trip) => {
    const preference = savedCollectionPreference(trip.metadata?.specialInstructions);
    const timing = trip.paymentMethod === 'PAY_AT_PICKUP' ? 'at pickup' : trip.paymentMethod === 'PAY_AT_DELIVERY' ? 'at drop' : '';
    return preference ? `${preference} ${timing}`.trim() : timing ? `Pay ${timing}` : '';
  };
  const renderTripCard = (trip: Trip) => {
    const completed = trip.status === 'COMPLETED', cancelled = trip.status === 'CANCELLED';
    const drops = trip.stops?.length ? trip.stops.map(stop => stop.location) : trip.drop ? [trip.drop] : [];
    const amount = trip.payablePaise ?? (typeof trip.fare === 'number' ? Math.round(trip.fare * 100) : undefined);
    const vehicle = trip.vehicleType;
    return <Pressable key={trip.id} testID={`trip-card-${trip.id}`} style={styles.card} accessibilityRole="button" accessibilityLabel={`Trip on ${new Date(trip.createdAt).toLocaleDateString()}`} onPress={() => {
      if (onTripSelect) { onTripSelect(trip); return; }
      if (!completed && !cancelled) navigation?.navigate('ActiveTripStack', { screen: 'CustomerLiveTrackingScreen' });
      else navigation?.navigate('HistoricalTripDetailScreen', { trip, tripId: trip.id });
    }}>
      <View style={styles.spread}><View style={styles.flex}><View style={[styles.badge, completed && styles.completedBadge, cancelled && styles.cancelledBadge]}><Text style={[styles.badgeText, completed && styles.completedText, cancelled && styles.cancelledText]}>{trip.status.replace(/_/g, ' ')}</Text></View><Text style={styles.caption}>{dateLabel(trip.createdAt)}</Text></View>{!cancelled && <View style={styles.amountColumn}><Text style={styles.amount}>{formatPaise(amount)}</Text><Text style={styles.caption}>{paymentChoice(trip)}</Text></View>}</View>
      <View style={styles.routeRow}><View style={styles.pickupColumn}><View style={styles.pickupDot}/><View style={styles.connector}/></View><View style={styles.flex}><Text style={styles.label}>PICKUP</Text><Text style={styles.address} numberOfLines={2}>{trip.pickup?.address || 'Pickup address unavailable'}</Text></View></View>
      <View style={styles.routeRow}><View style={styles.dropDot}><Text style={styles.dropNumber}>1</Text></View><View style={styles.flex}><View style={styles.inline}><Text style={styles.label}>DROP</Text>{drops.length > 1 && <Text style={styles.stopsBadge}>+{drops.length - 1} stop{drops.length > 2 ? 's' : ''}</Text>}</View><Text style={styles.address} numberOfLines={2}>{drops[0]?.address || 'Drop address unavailable'}</Text></View></View>
      <View style={styles.cardFooter}><View style={[styles.inline, styles.flex]}>{vehicle && <Image source={getVehicleImage(vehicle)} style={styles.vehicleImage} resizeMode="contain"/>}<Text style={styles.vehicleText} numberOfLines={1}>{vehicle ? vehicleLabelFor(getVehicleDisplayName(vehicle)) : 'Vehicle'}{typeof trip.weight === 'number' ? ` \u00B7 ${trip.weight} kg` : ''}</Text></View><Feather name="chevron-right" size={spacing.xl} color={colors.homeAction}/></View>
    </Pressable>;
  };
  return <SafeAreaView style={styles.page} edges={['top']}>
    <View style={styles.header}><View style={styles.flex}><Text style={styles.title}>Your trips</Text><Text style={styles.subtitle}>All your deliveries, in one place.</Text></View><Pressable style={styles.filterButton} accessibilityRole="button" accessibilityLabel="Filter trips" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen(true)}><Feather name="filter" size={spacing.xxl} color={colors.homeAction}/>{filter !== 'All trips' && <View style={styles.filterDot}/>}</Pressable></View>
    {showSkeleton ? <TripHistorySkeleton testID="trip-history-loading"/> : error && !trips.length ? <View style={styles.empty} testID="trip-history-error"><Feather name="alert-circle" size={spacing.xxxl} color={colors.error}/><Text style={styles.emptyTitle}>Unable to load trips</Text><Text style={styles.emptyText}>{error}</Text><Button label="Try Again" onPress={handleRetry}/></View> : !visibleTrips.length ? <View style={styles.empty} testID="empty-recent-state"><Feather name="clock" size={spacing.xxxl} color={colors.homeAction}/><Text style={styles.emptyTitle}>{trips.length ? 'No matching trips' : 'No trips yet'}</Text><Text style={styles.emptyText}>{trips.length ? 'Try another filter to see your trips.' : `Your deliveries with ${APP_NAME} will appear here.`}</Text><Button label={trips.length ? 'Show all trips' : 'Book a Ride'} onPress={trips.length ? () => setFilter('All trips') : handleBookRide}/></View> : <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchTrips} colors={[colors.homeAction]}/>}>
      {error && <View style={styles.notice}><Text style={styles.caption}>Could not refresh trips. Showing previously loaded details.</Text><Pressable accessibilityRole="button" accessibilityLabel="Retry trip history" onPress={handleRetry}><Text style={styles.address}>Retry</Text></Pressable></View>}
      {visibleTrips.map((trip, index) => <View key={trip.id}>{(index === 0 || month(visibleTrips[index-1].createdAt) !== month(trip.createdAt)) && <Text style={styles.month}>{month(trip.createdAt)}</Text>}{renderTripCard(trip)}</View>)}
    </ScrollView>}
    <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}><View style={styles.modalRoot}><Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel="Close trip filters" onPress={() => setFiltersOpen(false)}/><View style={[styles.filterSheet, {paddingBottom: Math.max(insets.bottom, spacing.lg)}]} accessibilityViewIsModal><View style={styles.spread}><Text style={styles.emptyTitle}>Filter trips</Text><Pressable style={styles.filterButton} accessibilityRole="button" accessibilityLabel="Close filters" onPress={() => setFiltersOpen(false)}><Feather name="x" size={spacing.xl} color={colors.homeAction}/></Pressable></View>{(['All trips','Completed','Cancelled'] as const).map(option => <Pressable key={option} style={styles.filterOption} accessibilityRole="radio" accessibilityLabel={option} accessibilityState={{selected:filter===option}} onPress={() => {setFilter(option);setFiltersOpen(false);}}><Text style={styles.address}>{option}</Text>{filter===option && <Feather name="check-circle" size={spacing.xl} color={colors.homePickup}/>}</Pressable>)}</View></View></Modal>
  </SafeAreaView>;
};
const styles = StyleSheet.create({
  page:{flex:1,backgroundColor:colors.surface},flex:{flex:1,minWidth:0},scroll:{flex:1},
  header:{flexDirection:'row',alignItems:'center',padding:spacing.xl,gap:spacing.md},title:{...typography.headlineLg,color:colors.homeAction},subtitle:{...typography.bodyMd,color:colors.secondary,marginTop:spacing.xs},
  filterButton:{width:spacing.rowHeightSm,height:spacing.rowHeightSm,borderWidth:1,borderColor:colors.outlineHairline,borderRadius:borderRadius.lg,alignItems:'center',justifyContent:'center'},filterDot:{position:'absolute',right:spacing.xs,top:spacing.xs,width:spacing.sm,height:spacing.sm,borderRadius:borderRadius.full,backgroundColor:colors.homePickup},
  content:{paddingHorizontal:spacing.lg,paddingBottom:spacing.xxl,gap:spacing.lg},month:{...typography.labelCaps,color:colors.secondary,marginBottom:spacing.md},
  card:{borderWidth:1,borderColor:colors.outlineHairline,borderRadius:borderRadius.xl,padding:spacing.lg,gap:spacing.md,backgroundColor:colors.surface},spread:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:spacing.md},inline:{flexDirection:'row',alignItems:'center',gap:spacing.sm},
  badge:{alignSelf:'flex-start',paddingVertical:spacing.xs,paddingHorizontal:spacing.sm,borderRadius:borderRadius.md,backgroundColor:colors.surfaceContainerLow},completedBadge:{backgroundColor:colors.successContainer},cancelledBadge:{backgroundColor:colors.errorContainer},badgeText:{...typography.labelCaps,color:colors.secondary},completedText:{color:colors.homePickup},cancelledText:{color:colors.error},caption:{...typography.labelSm,color:colors.secondary,marginTop:spacing.xs},
  amountColumn:{alignItems:'flex-end'},amount:{...typography.headlineMd,color:colors.homeAction,fontWeight:'700'},routeRow:{flexDirection:'row',alignItems:'flex-start',gap:spacing.md},pickupColumn:{width:spacing.xl,alignSelf:'stretch',alignItems:'center',paddingTop:spacing.xs},pickupDot:{width:spacing.md,height:spacing.md,borderRadius:borderRadius.full,backgroundColor:colors.homePickup},connector:{flex:1,minHeight:spacing.md,borderLeftWidth:1,borderColor:colors.outlineVariant,marginTop:spacing.xs},dropDot:{width:spacing.xl,height:spacing.xl,borderRadius:borderRadius.full,backgroundColor:colors.homeAction,alignItems:'center',justifyContent:'center',marginTop:spacing.xs},dropNumber:{...typography.labelSm,color:colors.onPrimary},label:{...typography.labelCaps,color:colors.secondary},address:{...typography.bodyMd,color:colors.homeAction,fontWeight:'600'},stopsBadge:{...typography.labelSm,color:colors.homePickup,backgroundColor:colors.selectionTint,borderRadius:borderRadius.sm,paddingHorizontal:spacing.xs},
  cardFooter:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderTopWidth:1,borderColor:colors.outlineHairline,paddingTop:spacing.sm},vehicleImage:{width:spacing.rowHeightSm,height:spacing.xxxl},vehicleText:{...typography.labelSm,color:colors.secondary,flexShrink:1},
  empty:{flex:1,padding:spacing.xxl,alignItems:'center',justifyContent:'center',gap:spacing.lg},emptyTitle:{...typography.headlineMd,color:colors.homeAction,fontWeight:'700'},emptyText:{...typography.bodyMd,color:colors.secondary,textAlign:'center'},notice:{padding:spacing.md,backgroundColor:colors.surfaceContainerLow,borderRadius:borderRadius.lg,gap:spacing.sm},
  modalRoot:{flex:1,justifyContent:'flex-end'},backdrop:{...StyleSheet.absoluteFillObject,backgroundColor:colors.black,opacity:0.4},filterSheet:{backgroundColor:colors.surface,borderTopLeftRadius:borderRadius.xxl,borderTopRightRadius:borderRadius.xxl,padding:spacing.lg,gap:spacing.md},filterOption:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',minHeight:spacing.rowHeightStandard,borderBottomWidth:1,borderColor:colors.outlineHairline},
});
export default TripHistoryScreen;
