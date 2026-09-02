import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Button from '../../components/atoms/Button';

export interface PaymentConfirmationScreenProps {
  readonly amount?: string;
  readonly paymentMethod?: string;
  readonly tripId?: string;
  readonly date?: string;
  readonly distance?: string;
  readonly onDone?: () => void;
  readonly onBack?: () => void;
  readonly onMoreOptions?: () => void;
}

const PaymentConfirmationScreen: React.FC<PaymentConfirmationScreenProps & { navigation?: any }> = ({
  amount = '₹450',
  paymentMethod = 'UPI (Secure)',
  tripId = '#TRP-8472-X',
  date = 'Oct 24, 2023 • 14:30',
  distance = '12.4 km',
  onDone,
  onBack,
  onMoreOptions,
  navigation,
}) => {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Trip Payment</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() =>
            onMoreOptions ? onMoreOptions() : navigation?.navigate('DigitalReceiptScreen')
          }
        >
          <Feather name="more-vertical" size={24} color={colors.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Status Card (Success) */}
        <View style={styles.statusCard}>
          <View style={styles.successIconBox}>
            <Feather name="check-circle" size={32} color={colors.onSecondaryFixed} />
          </View>
          <Text style={styles.statusTitle}>Payment Successful</Text>
          <Text style={styles.statusSubtitle}>Your transaction was completed.</Text>
        </View>

        {/* Payment Details */}
        <View style={styles.detailsCard}>
          <View style={styles.amountSection}>
            <Text style={styles.amountLabel}>Final Amount</Text>
            <Text style={styles.amountValue}>{amount}</Text>
          </View>
          
          <View style={styles.detailsRow}>
            <Text style={styles.detailLabel}>Payment Method</Text>
            <View style={styles.paymentMethodContainer}>
              <MaterialIcons name="account-balance" size={16} color={colors.onSurface} />
              <Text style={styles.detailValue}>{paymentMethod}</Text>
            </View>
          </View>

          <View style={styles.detailsRow}>
            <Text style={styles.detailLabel}>Status</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>Paid</Text>
            </View>
          </View>
        </View>

        {/* Trip Summary */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryTitle}>Trip Summary</Text>
          
          <View style={styles.summaryRow}>
            <Text style={styles.detailLabel}>Trip ID</Text>
            <Text style={styles.monoValue}>{tripId}</Text>
          </View>
          
          <View style={styles.summaryRow}>
            <Text style={styles.detailLabel}>Date</Text>
            <Text style={styles.detailValue}>{date}</Text>
          </View>
          
          <View style={styles.summaryRow}>
            <Text style={styles.detailLabel}>Distance</Text>
            <Text style={styles.detailValue}>{distance}</Text>
          </View>
        </View>
      </ScrollView>

      {/* Action Buttons */}
      <View style={styles.bottomActions}>
        <Button
          label="DONE"
          onPress={() => {
            onDone?.();
            navigation?.navigate('TripCompletedScreen');
          }}
          variant="primary"
          fullWidth
          size="lg"
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
    zIndex: 50,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingBottom: spacing.xxxl * 2, // Extra space for bottom actions
    gap: spacing.lg,
  },
  statusCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
  },
  successIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.secondaryFixed,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statusTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: 4,
  },
  statusSubtitle: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },
  detailsCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
  },
  amountSection: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant + '4D', // 30% opacity
    paddingBottom: spacing.lg,
    marginBottom: spacing.lg,
  },
  amountLabel: {
    fontSize: typography.labelCaps.fontSize,
    fontWeight: typography.labelCaps.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelCaps.fontFamily,
    letterSpacing: typography.labelCaps.letterSpacing,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  amountValue: {
    fontSize: 36, // Large text
    fontWeight: 'bold',
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    letterSpacing: -0.5,
  },
  detailsRow: {
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
  paymentMethodContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  detailValue: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurface,
    fontFamily: typography.bodyMd.fontFamily,
  },
  statusBadge: {
    backgroundColor: colors.secondaryFixedDim,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSecondaryFixed,
    fontFamily: typography.labelSm.fontFamily,
  },
  summaryCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
  },
  summaryTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.lg,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  monoValue: {
    fontSize: typography.dataMono.fontSize,
    fontWeight: typography.dataMono.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.dataMono.fontFamily,
    letterSpacing: typography.dataMono.letterSpacing,
  },
  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface + 'E6', // 90% opacity
    padding: spacing.marginMobile,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant + '33', // 20% opacity
  },
});

export default PaymentConfirmationScreen;
