import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface PaymentSuccessfulScreenProps {
  readonly amount?: string;
  readonly transactionId?: string;
  readonly date?: string;
  readonly paymentMethod?: string;
  readonly onViewBooking?: () => void;
  readonly onHome?: () => void;
}

const PaymentSuccessfulScreen: React.FC<PaymentSuccessfulScreenProps & { navigation?: any }> = ({
  amount = '₹ 340',
  transactionId = 'TXN-8472910',
  date = 'Oct 24, 2023',
  paymentMethod = 'UPI',
  onViewBooking,
  onHome,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Ambient Background Glow Mock */}
        <View style={styles.backgroundGlow} />

        <View style={styles.content}>
          {/* Success Icon */}
          <View style={styles.iconOuterRing}>
            <View style={styles.iconInnerRing}>
              <MaterialIcons name="check-circle" size={32} color={colors.onPrimaryFixed} />
            </View>
          </View>

          {/* Headline */}
          <Text style={styles.headline}>Payment Successful</Text>

          {/* Amount */}
          <Text style={styles.amountValue}>{amount}</Text>

          {/* Details Card */}
          <View style={styles.detailsCard}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Transaction ID</Text>
              <Text style={styles.monoValue}>{transactionId}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Date</Text>
              <Text style={styles.detailValue}>{date}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Payment Method</Text>
              <View style={styles.methodContainer}>
                <MaterialIcons name="payment" size={16} color={colors.onSurface} />
                <Text style={styles.detailValue}>{paymentMethod}</Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          <Button
            label="View Booking"
            onPress={() =>
              onViewBooking ? onViewBooking() : navigation?.navigate('PaymentConfirmationScreen')
            }
            variant="primary"
            fullWidth
            size="lg"
          />
          <Pressable
            style={styles.homeButton}
            onPress={() => (onHome ? onHome() : navigation?.navigate('HomeScreen'))}
          >
            <Text style={styles.homeButtonText}>Back to Home</Text>
          </Pressable>
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
  backgroundGlow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.secondaryContainer + '80', // 50% opacity
    // Blur is tricky in RN without extra packages, so just opacity + circle
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    zIndex: 10,
  },
  iconOuterRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    ...shadows.card,
  },
  iconInnerRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headline: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  amountValue: {
    fontSize: 36, // custom large text
    fontWeight: 'bold',
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
    marginBottom: spacing.xxl,
  },
  detailsCard: {
    width: '100%',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.surfaceVariant + '4D', // 30% opacity
    ...shadows.card,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  detailLabel: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  monoValue: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  detailValue: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  methodContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  homeButton: {
    marginTop: spacing.md,
    height: spacing.rowHeightSm,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
  },
  homeButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
  },
});

export default PaymentSuccessfulScreen;
