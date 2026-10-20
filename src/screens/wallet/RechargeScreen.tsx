import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { rechargePresets, mockPaymentMethod } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { AmountChip } from '../../components/atoms/AmountChip';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { useI18n } from '../../i18n';
import type { WalletScreenProps } from '../../types/navigation';

export interface RechargeScreenProps {
  readonly navigation: WalletScreenProps<'Recharge'>['navigation'];
  readonly testID?: string;
}

export const RechargeScreen: React.FC<RechargeScreenProps> = ({
  navigation,
  testID,
}) => {
  const { t } = useI18n();
  const [selectedAmount, setSelectedAmount] = useState<number>(0);
  const [customAmount, setCustomAmount] = useState('');

  const activeAmount = customAmount ? parseInt(customAmount, 10) || 0 : selectedAmount;
  const isValid = activeAmount >= 100;

  const handlePresetSelect = useCallback((amount: number) => {
    setSelectedAmount(amount);
    setCustomAmount('');
  }, []);

  const handleCustomChange = useCallback((text: string) => {
    setCustomAmount(text.replace(/\D/g, ''));
    setSelectedAmount(0);
  }, []);

  const handleContinue = useCallback(() => {
    if (!isValid) return;
    navigation.navigate('RechargeProcessing', {
      amount: activeAmount,
      paymentMethodId: mockPaymentMethod.id,
    });
  }, [navigation, isValid, activeAmount]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('wallet.rechargeTitle')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Amount presets */}
        <Text style={styles.label}>{t('wallet.enterAmount')}</Text>
        <View style={styles.presetsRow}>
          {rechargePresets.map((amount) => (
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
            placeholder={t('wallet.enterCustomAmount')}
            placeholderTextColor={colors.outline}
            value={customAmount}
            onChangeText={handleCustomChange}
            keyboardType="number-pad"
            maxLength={6}
          />
        </View>

        {activeAmount > 0 && !isValid ? (
          <Text style={styles.minAmountHint}>{t('wallet.minRechargeHint')}</Text>
        ) : null}

        {/* Payment method */}
        <View style={styles.paymentCard}>
          <Text style={styles.paymentLabel}>{t('wallet.defaultPayment')}</Text>
          <View style={styles.paymentRow}>
            <Icon name="account_balance" style={styles.paymentIcon} />
            <View style={styles.paymentInfo}>
              <Text style={styles.paymentName}>{mockPaymentMethod.label}</Text>
              <Text style={styles.paymentDigits}>•••• {mockPaymentMethod.lastFourDigits}</Text>
            </View>
            <Text style={styles.paymentDefault}>{t('common.default')}</Text>
          </View>
        </View>

        {/* Amount summary */}
        {isValid ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>{t('wallet.rechargeAmount')}</Text>
              <Text style={styles.summaryValue}>₹{activeAmount.toLocaleString()}</Text>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <PrimaryButton
        label={t('common.continue')}
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
  minAmountHint: {
    ...typography.labelSm,
    color: colors.error,
  },
  paymentCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
    ...shadows.sm,
  },
  paymentLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
  },
  paymentIcon: {
    fontSize: 24,
    color: colors.primary,
  },
  paymentInfo: {
    flex: 1,
    gap: 2,
  },
  paymentName: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.onSurface,
  },
  paymentDigits: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  paymentDefault: {
    ...typography.labelSm,
    color: colors.primary,
    fontWeight: '600',
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
