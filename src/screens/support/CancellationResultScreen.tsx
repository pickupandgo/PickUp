import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CommonActions } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../../theme';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Feather from 'react-native-vector-icons/Feather';
import Button from '../../components/atoms/Button';
import { useBooking } from '../../state/BookingContext';
import { formatCurrency } from '../../services/cancellationService';

export interface CancellationResultScreenProps {
  readonly tripId?: string;
  readonly feeAmount?: string | null;
  readonly onHome?: () => void;
}

const formatTripReference = (ref?: string): string => {
  if (!ref) return '#TRP-CANCELLED';
  const clean = ref.trim();
  return clean.startsWith('#') ? clean : `#${clean}`;
};

const CancellationResultScreen: React.FC<
  CancellationResultScreenProps & { navigation?: any; route?: any }
> = ({
  tripId: propTripId,
  feeAmount: propFeeAmount,
  onHome,
  navigation,
  route,
}) => {
  const { trip: contextTrip, ride: contextRide, clearActiveRide } = useBooking();

  // Resolve real trip reference: prefer route params -> prop -> context -> fallback
  const rawTripId =
    route?.params?.tripId ||
    route?.params?.tripReference ||
    propTripId ||
    route?.params?.cancelledTrip?.externalRef ||
    route?.params?.cancelledTrip?.id ||
    contextTrip?.externalRef ||
    contextTrip?.id ||
    contextRide?.externalRef ||
    contextRide?.id;

  const displayTripId = formatTripReference(rawTripId);

  // Resolve real confirmed fee
  const displayFeeAmount =
    route?.params?.feeAmount !== undefined
      ? (typeof route.params.feeAmount === 'number'
          ? formatCurrency(route.params.feeAmount)
          : route.params.feeAmount)
      : route?.params?.cancellationFee !== undefined
      ? (typeof route.params.cancellationFee === 'number'
          ? formatCurrency(route.params.cancellationFee)
          : route.params.cancellationFee)
      : propFeeAmount !== undefined
      ? (typeof propFeeAmount === 'number'
          ? formatCurrency(propFeeAmount)
          : propFeeAmount)
      : null;

  // 10-Second Countdown implementation
  const [secondsLeft, setSecondsLeft] = useState<number>(10);
  const timerRef = useRef<any>(null);
  const hasNavigatedRef = useRef<boolean>(false);

  const handleGoHome = useCallback(() => {
    if (hasNavigatedRef.current) return;
    hasNavigatedRef.current = true;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (onHome) {
      onHome();
    } else {
      clearActiveRide();
      navigation?.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'MainTabs', params: { screen: 'HomeScreen' } }],
        })
      );
    }
  }, [onHome, clearActiveRide, navigation]);

  // Handle hardware Back button to trigger instant home navigation
  useEffect(() => {
    if (BackHandler && typeof BackHandler.addEventListener === 'function') {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        handleGoHome();
        return true;
      });
      return () => backHandler?.remove?.();
    }
  }, [handleGoHome]);

  // Countdown timer: 10s down to 0
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          handleGoHome();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [handleGoHome]);

  const countdownText = `Returning to Home in ${secondsLeft} second${secondsLeft === 1 ? '' : 's'}`;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Cancel Icon */}
        <View style={styles.iconContainer}>
          <View style={styles.iconRingOuter} />
          <View style={styles.iconRingInner} />
          <View style={styles.iconBox}>
            <MaterialIcons name="cancel" size={40} color={colors.onSurfaceVariant} />
          </View>
        </View>

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Trip Cancelled</Text>
          <View style={styles.subtitleRow}>
            <Text style={styles.subtitleText}>Your trip </Text>
            <View style={styles.tripIdBadge}>
              <Text style={styles.tripIdText}>{displayTripId}</Text>
            </View>
            <Text style={styles.subtitleText}> has been cancelled.</Text>
          </View>

          {/* Fee Info Box */}
          {displayFeeAmount ? (
            <View style={styles.infoBox}>
              <MaterialIcons
                name="info"
                size={20}
                color={colors.onSurfaceVariant}
                style={styles.infoIcon}
              />
              <Text style={styles.infoText}>
                A cancellation fee of {displayFeeAmount} has been charged to your account.
              </Text>
            </View>
          ) : (
            <View style={styles.infoBox}>
              <MaterialIcons
                name="info"
                size={20}
                color={colors.onSurfaceVariant}
                style={styles.infoIcon}
              />
              <Text style={styles.infoText}>
                No cancellation fee applies.
              </Text>
            </View>
          )}
        </View>

        {/* Action & Visible Countdown */}
        <View style={styles.actionContainer}>
          <View style={styles.countdownBox}>
            <Feather
              name="clock"
              size={14}
              color={colors.onSurfaceVariant}
              style={styles.countdownIcon}
            />
            <Text style={styles.countdownText}>{countdownText}</Text>
          </View>
          <Button
            label="BACK TO HOME"
            onPress={handleGoHome}
            variant="primary"
            fullWidth
            size="lg"
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.marginMobile,
  },
  iconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    width: 96,
    height: 96,
    marginBottom: spacing.xxl,
  },
  iconRingOuter: {
    position: 'absolute',
    width: 125,
    height: 125,
    borderRadius: 62.5,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '1A',
  },
  iconRingInner: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    borderColor: colors.outlineVariant + '4D',
  },
  iconBox: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceVariant + '80',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textContainer: {
    alignItems: 'center',
    width: '100%',
    marginBottom: spacing.xxxl,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.md,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: spacing.xl,
  },
  subtitleText: {
    fontSize: typography.bodyLg.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
  },
  tripIdBadge: {
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  tripIdText: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceContainerLow,
    padding: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.surfaceContainerHighest,
    width: '100%',
  },
  infoIcon: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  infoText: {
    flex: 1,
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    lineHeight: 20,
  },
  actionContainer: {
    width: '100%',
    position: 'absolute',
    bottom: spacing.marginMobile,
  },
  countdownBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  countdownIcon: {
    marginRight: 6,
  },
  countdownText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    fontWeight: '500',
  },
});

export default CancellationResultScreen;
