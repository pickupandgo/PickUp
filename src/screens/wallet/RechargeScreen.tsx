import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../../theme';
import { rechargePresets } from '../../data/mockData';
import { HomeBrandMark } from '../../components/molecules/HomeArtwork';
import { useWallet } from '../../hooks/useWallet';
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
  const [editing, setEditing] = useState(false);
  const wallet = useWallet({ includeTransactions: false });
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
    Keyboard.dismiss();
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

  const inputValue = editing
    ? customAmount || (selectedAmount ? String(selectedAmount) : '')
    : activeAmount ? activeAmount.toLocaleString('en-IN') : '';

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Back" style={styles.backButton}>
          <Icon name="arrow_back" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Recharge wallet</Text>
        <HomeBrandMark />
      </View>
      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined} enabled={Platform.OS === 'ios'}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {!paymentsEnabled ? <View style={styles.noticeCard} accessibilityRole="alert">
            <Icon name="info_outline" size={19} color={colors.onSurfaceMuted} />
            <Text style={styles.noticeText}>{notConfiguredMessage}</Text>
          </View> : null}

          <View style={styles.balanceSection}>
            <View style={styles.balanceRow}>
              <Icon name="account_balance_wallet" size={22} color={colors.navigationIcon} />
              <Text style={styles.balanceLabel}>Current balance</Text>
              {wallet.isLoading && !wallet.balance ? <ActivityIndicator color={colors.homeGreen} accessibilityLabel="Loading current balance" /> :
                <Text style={styles.balanceValue}>{wallet.balance ? formatRupees(wallet.balance.balance, wallet.balance.currency) : '\u2014'}</Text>}
            </View>
            {wallet.error ? <Pressable onPress={() => { wallet.refresh().catch(() => undefined); }} accessibilityRole="button" style={styles.retryBalance}>
              <Text style={styles.retryText} accessibilityLiveRegion="polite">Could not refresh balance. Tap to retry.</Text>
            </Pressable> : null}
          </View>

          <View style={styles.amountSection}>
            <Text style={styles.question}>How much would you like to add?</Text>
            <View style={styles.amountUnderline}>
              <Text style={styles.currencyPrefix}>{'\u20b9'}</Text>
              <TextInput style={styles.amountInput} placeholder="0" placeholderTextColor={colors.homeMuted}
                value={inputValue} onChangeText={handleCustomChange} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)}
                keyboardType="number-pad" maxLength={6} accessibilityLabel="Recharge amount in rupees" selectionColor={colors.homeGreen} />
            </View>
            <Text style={styles.amountHint}>Enter any amount</Text>
          </View>

          <View style={styles.presetsRow}>
            {rechargePresets.map(amount => {
              const selected = selectedAmount === amount && !customAmount;
              return <Pressable key={amount} onPress={() => handlePresetSelect(amount)} accessibilityRole="button"
                accessibilityLabel={formatRupees(amount)} accessibilityState={{ selected }}
                style={({ pressed }) => [styles.preset, selected && styles.presetSelected, pressed && styles.pressed]}>
                <Text style={[styles.presetLabel, selected && styles.presetLabelSelected]}>{formatRupees(amount)}</Text>
                {selected && <Icon name="check_circle" size={13} color={colors.homeGreen} />}
              </Pressable>;
            })}
          </View>

          <View style={styles.securityRow}>
            <Icon name="verified_user" size={26} color={colors.homeGreen} />
            <View style={styles.securityContent}>
              <Text style={styles.securityTitle}>Secure checkout</Text>
              <Text style={styles.securityText}>Payments are handled by Razorpay. Multiple Ride never sees your card details or UPI PIN.</Text>
              <Text style={styles.poweredBy}>Powered by Razorpay</Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Recharge amount</Text>
            <Text style={styles.summaryValue}>{activeAmount >= 1 ? formatRupees(activeAmount) : '\u2014'}</Text>
          </View>
          <Pressable onPress={() => { Keyboard.dismiss(); handleContinue(); }} disabled={!isValid}
            accessibilityRole="button" accessibilityLabel="Continue to payment" accessibilityState={{ disabled: !isValid }}
            style={({ pressed }) => [styles.continueButton, !isValid && styles.disabledButton, pressed && styles.pressed]}>
            <Text style={styles.continueLabel}>Continue to payment</Text>
            <Icon name="arrow_forward" size={21} color={colors.onPrimary} />
          </Pressable>
          <Text style={styles.confirmationHint}>Balance updates after payment confirmation.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 10, paddingRight: 20 },
  backButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 17, lineHeight: 23, fontWeight: '500', color: colors.primary },
  content: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 28 },
  noticeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 9, backgroundColor: colors.surfaceContainerLow, marginTop: 12 },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  balanceSection: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.homeBorder, paddingVertical: 20, gap: 6 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  balanceLabel: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.onSurfaceMuted },
  balanceValue: { fontSize: 16, lineHeight: 22, fontWeight: '500', color: colors.primary, flexShrink: 1 },
  retryBalance: { paddingVertical: 6 },
  retryText: { fontSize: 11, lineHeight: 17, color: colors.error },
  amountSection: { alignItems: 'center', paddingTop: 30, paddingBottom: 28 },
  question: { fontSize: 13, lineHeight: 19, color: colors.onSurfaceMuted, textAlign: 'center', marginBottom: 16 },
  amountUnderline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: colors.homeGreen, paddingBottom: 5, maxWidth: '95%' },
  currencyPrefix: { fontSize: 32, lineHeight: 42, fontWeight: '500', color: colors.primary, marginRight: 2 },
  amountInput: { fontSize: 32, lineHeight: 42, fontWeight: '500', color: colors.primary, minWidth: 100, maxWidth: 200, paddingVertical: 0, paddingHorizontal: 2, flexShrink: 1, textAlign: 'center' },
  amountHint: { fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted, marginTop: 10 },
  presetsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 28 },
  preset: { flexGrow: 1, flexBasis: '21%', minWidth: 60, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 8, borderWidth: 1, borderColor: colors.outlineSubtle, borderRadius: 10 },
  presetSelected: { backgroundColor: colors.homeMint, borderColor: colors.homeGreen },
  presetLabel: { fontSize: 12, lineHeight: 17, color: colors.primary, fontWeight: '500', flexShrink: 1 },
  presetLabelSelected: { color: colors.homeGreen },
  securityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.homeBorder, paddingTop: 22 },
  securityContent: { flex: 1, minWidth: 0, gap: 5 },
  securityTitle: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.primary },
  securityText: { fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted },
  poweredBy: { fontSize: 10, lineHeight: 16, color: colors.homeMuted, marginTop: 5 },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.homeBorder, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14, gap: 12, backgroundColor: colors.surfaceContainerLowest },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  summaryLabel: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  summaryValue: { fontSize: 16, lineHeight: 22, fontWeight: '500', color: colors.primary, flexShrink: 1 },
  continueButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 11, backgroundColor: colors.homeGreen },
  continueLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.onPrimary, flexShrink: 1, textAlign: 'center' },
  disabledButton: { backgroundColor: colors.homeOffline },
  pressed: { opacity: 0.75 },
  confirmationHint: { fontSize: 10, lineHeight: 16, color: colors.onSurfaceMuted, textAlign: 'center' },
});

export default RechargeScreen;
