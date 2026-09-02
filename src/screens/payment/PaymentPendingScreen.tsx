import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather } from '@expo/vector-icons';

export interface PaymentPendingScreenProps {
  readonly amount?: string;
  readonly onClose?: () => void;
  readonly onCheckStatus?: () => void;
  readonly onCancelPayment?: () => void;
}

const PaymentPendingScreen: React.FC<PaymentPendingScreenProps & { navigation?: any }> = ({
  amount = '₹ 340',
  onClose,
  onCheckStatus,
  onCancelPayment,
  navigation,
}) => {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400, // 70% of 2s in HTML
          easing: Easing.bezier(0.215, 0.61, 0.355, 1),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1, // hold
          duration: 600, // remaining 30%
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulse]);

  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.8, 1.3],
  });

  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.5, 0],
  });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Background Ambience */}
      <View style={styles.ambientTopRight} />
      <View style={styles.ambientBottomLeft} />

      <View style={styles.container}>
        {/* Top App Bar */}
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            onPress={() => (onClose ? onClose() : navigation?.goBack())}
          >
            <Feather name="x" size={24} color={colors.primary} />
          </Pressable>
          <Text style={styles.headerTitle}>Pick Up</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.content}>
          {/* Status Indicator */}
          <View style={styles.indicatorContainer}>
            <Animated.View
              style={[
                styles.pulseRing,
                {
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />
            {/* Second ring delayed slightly for visual effect */}
            <Animated.View
              style={[
                styles.pulseRingInner,
                {
                  transform: [{ scale: pulseScale }],
                  opacity: pulseOpacity,
                },
              ]}
            />

            <View style={styles.coreIconContainer}>
              <Feather name="clock" size={32} color={colors.onSurfaceVariant} />
            </View>
          </View>

          {/* Text Content */}
          <Text style={styles.title}>Payment Pending</Text>
          <Text style={styles.subtitle}>
            We are waiting for confirmation from your bank or UPI app. This usually takes a few seconds.
          </Text>

          {/* Amount Card */}
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>AMOUNT</Text>
            <Text style={styles.amountValue}>{amount}</Text>
          </View>

          {/* Actions */}
          <View style={styles.actionContainer}>
            <Pressable
              style={styles.checkButton}
              onPress={() =>
                onCheckStatus ? onCheckStatus() : navigation?.navigate('PaymentSuccessfulScreen')
              }
            >
              <Feather name="refresh-cw" size={20} color={colors.onPrimary} />
              <Text style={styles.checkButtonText}>Check Status</Text>
            </Pressable>
            
            <Pressable
              style={styles.cancelButton}
              onPress={() =>
                onCancelPayment ? onCancelPayment() : navigation?.navigate('PaymentFailedScreen')
              }
            >
              <Text style={styles.cancelButtonText}>Cancel Payment</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  container: {
    flex: 1,
    position: 'relative',
  },
  ambientTopRight: {
    position: 'absolute',
    top: '-20%',
    right: '-10%',
    width: '50%',
    height: '50%',
    borderRadius: 999,
    backgroundColor: colors.surfaceContainerHighest,
    opacity: 0.3,
  },
  ambientBottomLeft: {
    position: 'absolute',
    bottom: '-20%',
    left: '-10%',
    width: '60%',
    height: '60%',
    borderRadius: 999,
    backgroundColor: colors.secondaryFixed,
    opacity: 0.2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    zIndex: 10,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.marginMobile,
    maxWidth: 400,
    alignSelf: 'center',
    width: '100%',
    zIndex: 10,
  },

  // Status Indicator
  indicatorContainer: {
    width: 128,
    height: 128,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    position: 'relative',
  },
  pulseRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 64,
    backgroundColor: colors.tertiaryFixed,
  },
  pulseRingInner: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    bottom: 8,
    borderRadius: 56,
    backgroundColor: colors.tertiaryFixedDim,
  },
  coreIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.surfaceContainerHighest,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
    zIndex: 10,
  },

  // Typography
  title: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: spacing.xl,
  },

  // Amount Card
  amountCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    padding: spacing.xl,
    width: '100%',
    alignItems: 'center',
    marginBottom: 48,
    ...shadows.card,
  },
  amountLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelSm.letterSpacing,
    marginBottom: spacing.xs,
  },
  amountValue: {
    fontSize: 30, // 3xl roughly
    fontWeight: '700',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
  },

  // Actions
  actionContainer: {
    width: '100%',
    gap: spacing.md,
  },
  checkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    height: 56,
    borderRadius: borderRadius.full,
    ...shadows.card,
  },
  checkButtonText: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onPrimary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  cancelButton: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.full,
  },
  cancelButtonText: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
});

export default PaymentPendingScreen;
