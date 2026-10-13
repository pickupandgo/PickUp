import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  colors,
  typography,
  spacing,
  borderRadius,
  shadows,
} from '../../theme';
import { rechargePresets, walletLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { AmountChip } from '../../components/atoms/AmountChip';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { WalletService } from '../../services/wallet/WalletService';
import { newIdempotencyKey } from '../../services/payments/idempotency';
import { formatRupees, rupeesToPaise } from '../../services/payments/money';
import {
  describePaymentsError,
  PaymentsApiError,
} from '../../services/payments/paymentsErrors';
import type { WalletScreenProps } from '../../types/navigation';

export interface RechargeScreenProps {
  readonly navigation: WalletScreenProps<'Recharge'>['navigation'];
  readonly testID?: string;
}

/** Shown when this build has no payments backend configured. */
const notConfiguredMessage = __DEV__
  ? 'Recharge is off in this build. Set PAYMENTS_API_BASE_URL in .env and rebuild the app.'
  : describePaymentsError(
      new PaymentsApiError('NOT_CONFIGURED', 'Not configured', 0),
    );

export const RechargeScreen: React.FC<RechargeScreenProps> = ({
  navigation,
  testID,
}) => {
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState('');
  // Blocks a double tap from starting two payments; reset whenever this screen is shown again.
  const submitting = useRef(false);

  useFocusEffect(
    useCallback(() => {
      submitting.current = false;
    }, []),
  );

  const paymentsEnabled = WalletService.getMode() === 'backend';
  const activeAmount = customAmount
    ? Number.parseInt(customAmount, 10) || 0
    : selectedAmount;
  // Whole rupees only. Minimum and maximum amounts are enforced by the server, which replies
  // with the allowed range if the amount is outside it.
  const isValid = paymentsEnabled && activeAmount >= 1;

  const handlePresetSelect = useCallback((amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount('');
  }, []);

  const handleCustomChange = useCallback((text: string) => {
    setCustomAmount(text.replace(/\D/g, '').replace(/^0+/, ''));
    setSelectedAmount(0);
  }, []);

  const handleContinue = useCallback(() => {
    if (!isValid || submitting.current) {
      return;
    }
    submitting.current = true;
    navigation.push('RechargeProcessing', {
      amountPaise: rupeesToPaise(activeAmount),
      // A new attempt gets a new key; retries inside the attempt reuse it.
      idempotencyKey: newIdempotencyKey(),
    });
  }, [navigation, isValid, activeAmount]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={walletLabels.rechargeTitle}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {!paymentsEnabled ? (
          <View style={styles.noticeCard} accessibilityRole="alert">
            <Icon name="info" size={20} color={colors.onSurfaceVariant} />
            <Text style={styles.noticeText}>{notConfiguredMessage}</Text>
          </View>
        ) : null}

        {/* Amount presets */}
        <Text style={styles.label}>{walletLabels.enterAmountLabel}</Text>
        <View style={styles.presetsRow}>
          {rechargePresets.map(amount => (
            <AmountChip
              key={amount}
              amount={amount}
              currency="₹"
              selected={selectedAmount === amount && !customAmount}
              onPress={handlePresetSelect}
            />
          ))}
        </View>

        {/* Custom amount */}
        <View style={styles.customInputContainer}>
          <Text style={styles.currencyPrefix}>₹</Text>
          <TextInput
            style={styles.customInput}
            placeholder="Enter custom amount"
            placeholderTextColor={colors.outline}
            value={customAmount}
            onChangeText={handleCustomChange}
            keyboardType="number-pad"
            maxLength={6}
            accessibilityLabel="Recharge amount in rupees"
          />
        </View>

        {/* Payment provider */}
        <View style={styles.secureCard}>
          <Icon name="verified_user" size={24} color={colors.primary} />
          <View style={styles.secureInfo}>
            <Text style={styles.secureTitle}>Secure payment by Razorpay</Text>
            <Text style={styles.secureText}>
              You pay on Razorpay's secure checkout. PickUp never sees your card
              details or UPI PIN.
            </Text>
          </View>
        </View>

        {/* Amount summary */}
        {isValid ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Recharge Amount</Text>
              <Text style={styles.summaryValue}>
                {formatRupees(activeAmount)}
              </Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <PrimaryButton
        label={walletLabels.continueLabel}
        onPress={handleContinue}
        disabled={!isValid}
        style={styles.continueButton}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    gap: spacing.containerPadding,
  },
  noticeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.gutter,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surfaceContainerHigh,
  },
  noticeText: {
    ...typography.bodyMd,
    flex: 1,
    color: colors.onSurfaceVariant,
  },
  label: {
    ...typography.headlineSm,
    color: colors.onSurface,
    marginTop: spacing.xs,
  },
  presetsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.gutter,
  },
  customInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.containerPadding,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  currencyPrefix: {
    ...typography.headlineMd,
    color: colors.onSurfaceVariant,
    marginRight: spacing.xs,
  },
  customInput: {
    flex: 1,
    ...typography.headlineMd,
    color: colors.onSurface,
    paddingVertical: spacing.containerPadding,
  },
  secureCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    ...shadows.sm,
  },
  secureInfo: {
    flex: 1,
    gap: 2,
  },
  secureTitle: {
    ...typography.bodyMd,
    fontWeight: '600',
    color: colors.onSurface,
  },
  secureText: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  summaryCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    ...shadows.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  summaryValue: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  continueButton: {
    marginHorizontal: spacing.containerPadding,
    marginBottom: spacing.lg,
  },
});

export default RechargeScreen;
