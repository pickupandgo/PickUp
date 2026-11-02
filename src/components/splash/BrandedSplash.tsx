import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Feather from 'react-native-vector-icons/Feather';
import { colors, spacing, borderRadius, typography } from '../../theme';

export default function BrandedSplash({ checkingAccount }: { readonly checkingAccount: boolean }) {
  const { width } = useWindowDimensions();
  const routeWidth = Math.min(width - spacing.xxl * 2, 360);
  const travel = useRef(new Animated.Value(0)).current;
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const arrive = Animated.timing(entrance, { toValue: 1, duration: 450, useNativeDriver: true });
    const drive = Animated.loop(Animated.timing(travel, {
      toValue: 1, duration: 3000, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
    }));
    arrive.start();
    drive.start();
    return () => { arrive.stop(); drive.stop(); };
  }, [entrance, travel]);

  const bikeX = travel.interpolate({ inputRange: [0, 1], outputRange: [-60, routeWidth - 85] });
  const progressX = travel.interpolate({ inputRange: [0, 1], outputRange: [-routeWidth * 0.25, routeWidth] });

  return <View style={styles.page}>
    <Animated.View style={[styles.brand, { opacity: entrance, transform: [{ translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }]}>
      <Image source={require('../../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
      <Text style={styles.title}>PICKUP</Text>
      <Text style={styles.tagline}>Your goods, on the move.</Text>
    </Animated.View>

    <View style={[styles.routeCard, { width: routeWidth }]} accessible accessibilityLabel="Bike moving from pickup to drop">
      <View style={styles.routeLabels}>
        <View style={styles.routeEndpoint}><View style={[styles.endpointDot, styles.pickupDot]} /><Text style={styles.endpointText}>PICKUP</Text></View>
        <View style={styles.routeEndpoint}><Text style={styles.endpointText}>DROP</Text><View style={[styles.endpointDot, styles.dropDot]} /></View>
      </View>
      <View style={styles.road} />
      <Animated.Image source={require('../../assets/vehicles/map/bike_delivery.png')} resizeMode="contain" style={[styles.bike, { transform: [{ translateX: bikeX }] }]} />
      <View style={styles.routeCaption}><Feather name="navigation" size={spacing.md} color={colors.homePickup} /><Text style={styles.routeCaptionText}>Moving with you, every stop.</Text></View>
    </View>

    <View style={[styles.progressSection, { width: routeWidth }]}>
      <Text style={styles.loadingLabel}>{checkingAccount ? 'Checking your account…' : 'Getting things ready…'}</Text>
      <View style={styles.progressTrack}><Animated.View style={[styles.progressSweep, { width: routeWidth * 0.25, transform: [{ translateX: progressX }] }]} /></View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.splashBackground, paddingHorizontal: spacing.xxl },
  brand: { alignItems: 'center', marginBottom: spacing.xxxl },
  logo: { width: 84, height: 84 },
  title: { ...typography.headlineMd, fontSize: 30, lineHeight: 38, fontWeight: '800', letterSpacing: 2, color: colors.homeAction, marginTop: spacing.sm },
  tagline: { ...typography.bodyMd, color: colors.secondary, marginTop: spacing.xs },
  routeCard: { height: 166, backgroundColor: colors.surface, borderRadius: borderRadius.xxl, overflow: 'hidden', borderWidth: 1, borderColor: colors.splashHalo },
  routeLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  routeEndpoint: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  endpointDot: { width: spacing.sm, height: spacing.sm, borderRadius: borderRadius.full },
  pickupDot: { backgroundColor: colors.homePickup },
  dropDot: { backgroundColor: colors.error },
  endpointText: { ...typography.labelSm, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, color: colors.secondary },
  road: { position: 'absolute', left: spacing.lg, right: spacing.lg, top: 95, borderTopWidth: 2, borderStyle: 'dashed', borderColor: colors.outlineVariant },
  bike: { position: 'absolute', width: 88, height: 78, top: 41, left: 0 },
  routeCaption: { position: 'absolute', bottom: spacing.sm, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  routeCaptionText: { ...typography.labelSm, color: colors.secondary },
  progressSection: { marginTop: spacing.xxxl, gap: spacing.md },
  loadingLabel: { ...typography.labelSm, color: colors.homeAction, textAlign: 'center' },
  progressTrack: { height: spacing.xs, backgroundColor: colors.splashHalo, borderRadius: borderRadius.full, overflow: 'hidden' },
  progressSweep: { height: spacing.xs, backgroundColor: colors.homePickup, borderRadius: borderRadius.full },
});
