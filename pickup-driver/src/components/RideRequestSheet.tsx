import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, shadows } from '../theme';
import { RIDE_REQUEST_TTL_MS, type RideRequestSummary } from '../api/driver';

/**
 * Incoming ride request: fare and route up front, with a countdown that expires
 * the offer — the pattern Rapido and Porter use.
 *
 * The countdown is derived from the ride's own `createdAt`, not from when this
 * mounted, because the engine expires the request 15s after creation regardless
 * of when the driver's app happened to see it. A mount-based timer would show a
 * full 15s on an offer that was already dead.
 */

export interface RideRequestSheetProps {
  readonly request: RideRequestSummary;
  readonly onAccept: () => void;
  readonly onDecline: () => void;
  readonly onExpire: () => void;
  readonly isSubmitting?: boolean;
}

const RideRequestSheet: React.FC<RideRequestSheetProps> = ({
  request,
  onAccept,
  onDecline,
  onExpire,
  isSubmitting = false,
}) => {
  const expiresAt = useMemo(
    () => new Date(request.createdAt).getTime() + RIDE_REQUEST_TTL_MS,
    [request.createdAt]
  );

  const [remainingMs, setRemainingMs] = useState(() => Math.max(0, expiresAt - Date.now()));
  const barAnim = useRef(new Animated.Value(1)).current;
  const firedExpiry = useRef(false);

  useEffect(() => {
    firedExpiry.current = false;
    const initial = Math.max(0, expiresAt - Date.now());
    setRemainingMs(initial);

    barAnim.setValue(initial / RIDE_REQUEST_TTL_MS);
    Animated.timing(barAnim, {
      toValue: 0,
      duration: initial,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    const id = setInterval(() => {
      const left = Math.max(0, expiresAt - Date.now());
      setRemainingMs(left);
      if (left === 0 && !firedExpiry.current) {
        firedExpiry.current = true;
        clearInterval(id);
        onExpire();
      }
    }, 200);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const seconds = Math.ceil(remainingMs / 1000);
  const isUrgent = seconds <= 5;

  return (
    <View style={styles.overlay}>
      <View style={styles.sheet}>
        <View style={styles.timerRow}>
          <View style={[styles.timerBadge, isUrgent && styles.timerBadgeUrgent]}>
            <Feather name="clock" size={14} color={isUrgent ? colors.onError : colors.onPrimary} />
            <Text style={[styles.timerText, isUrgent && styles.timerTextUrgent]}>{seconds}s</Text>
          </View>
          <Text style={styles.timerLabel}>New ride request</Text>
        </View>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              isUrgent && styles.progressFillUrgent,
              { width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
            ]}
          />
        </View>

        <View style={styles.fareRow}>
          <View>
            <Text style={styles.fareLabel}>YOU EARN</Text>
            <Text style={styles.fareValue}>₹ {request.fare ?? '—'}</Text>
          </View>
          <View style={styles.metaColumn}>
            {request.vehicleType && <Text style={styles.metaText}>{request.vehicleType}</Text>}
            {typeof request.weight === 'number' && (
              <Text style={styles.metaText}>{request.weight} kg</Text>
            )}
          </View>
        </View>

        <View style={styles.routeCard}>
          <View style={styles.routeRow}>
            <View style={[styles.routeDot, styles.pickupDot]} />
            <View style={styles.routeTextWrapper}>
              <Text style={styles.routeLabel}>PICKUP</Text>
              <Text style={styles.routeAddress} numberOfLines={2}>
                {request.pickup.address ?? 'Pickup location'}
              </Text>
            </View>
          </View>

          <View style={styles.routeConnector} />

          <View style={styles.routeRow}>
            <View style={[styles.routeDot, styles.dropDot]} />
            <View style={styles.routeTextWrapper}>
              <Text style={styles.routeLabel}>DROP</Text>
              <Text style={styles.routeAddress} numberOfLines={2}>
                {request.drop.address ?? 'Drop location'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.actionsRow}>
          <Pressable
            style={styles.declineButton}
            onPress={onDecline}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Decline ride"
          >
            <Text style={styles.declineText}>DECLINE</Text>
          </Pressable>
          <Pressable
            style={[styles.acceptButton, isSubmitting && styles.acceptButtonDisabled]}
            onPress={onAccept}
            disabled={isSubmitting}
            accessibilityRole="button"
            accessibilityLabel="Accept ride"
          >
            <Text style={styles.acceptText}>{isSubmitting ? 'ACCEPTING…' : 'ACCEPT'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
    ...shadows.elevated,
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  timerBadgeUrgent: { backgroundColor: colors.error },
  timerText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '700',
    color: colors.onPrimary,
    fontFamily: typography.dataMono.fontFamily,
  },
  timerTextUrgent: { color: colors.onError },
  timerLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: borderRadius.full,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.full,
  },
  progressFillUrgent: { backgroundColor: colors.error },
  fareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fareLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  fareValue: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
  },
  metaColumn: { alignItems: 'flex-end', gap: 2 },
  metaText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  routeCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  routeRow: { flexDirection: 'row', gap: spacing.md },
  routeDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  pickupDot: { backgroundColor: colors.statusGreen },
  dropDot: { backgroundColor: colors.primary },
  routeConnector: {
    width: 2,
    height: 18,
    backgroundColor: colors.outlineVariant,
    marginLeft: 5,
    marginVertical: 2,
  },
  routeTextWrapper: { flex: 1 },
  routeLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
  },
  routeAddress: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
    marginTop: 2,
  },
  actionsRow: { flexDirection: 'row', gap: spacing.md },
  declineButton: {
    flex: 1,
    height: 52,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '700',
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
  acceptButton: {
    flex: 2,
    height: 52,
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButtonDisabled: { opacity: 0.6 },
  acceptText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: '700',
    color: colors.onPrimary,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default RideRequestSheet;
