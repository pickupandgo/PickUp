import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography, shadows } from '../../theme';
import Feather from 'react-native-vector-icons/Feather';
import MaterialIcons from 'react-native-vector-icons/MaterialIcons';
import Button from '../../components/atoms/Button';
import { useBooking } from '../../state/BookingContext';
import type { PaymentMethod } from '../../api/types';
import { PAYMENT_METHOD_OPTIONS } from '../../data/paymentMethods';

export interface PaymentMethodScreenProps {
  readonly onContinue?: (method: PaymentMethod) => void;
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
}

/** Exactly two payment methods (review H), from the shared source of truth. */
const PAYMENT_METHODS = PAYMENT_METHOD_OPTIONS;

const PaymentMethodScreen: React.FC<PaymentMethodScreenProps & { navigation?: any }> = ({
  onContinue,
  onBack,
  onHelp,
  navigation,
}) => {
  const { draft, setPaymentMethod } = useBooking();
  // Display only: the amount comes from the server quote, never a local calculation.
  const amount = draft.quote ? `₹${(draft.quote.payablePaise / 100).toFixed(2)}` : '--';

  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(
    draft.paymentMethod ?? 'PAY_AT_PICKUP',
  );

  const handleContinue = () => {
    setPaymentMethod(selectedMethod);
    onContinue?.(selectedMethod);
    navigation?.goBack();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable style={styles.iconButton} onPress={() => (onBack ? onBack() : navigation?.goBack())}>
          <Feather name="arrow-left" size={24} color={colors.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Payment</Text>
        <Pressable
          style={styles.helpButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Text style={styles.helpButtonText}>Help</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.amountSection}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>Fare for this delivery</Text>
            <Text style={styles.amountValue}>{amount}</Text>
            <Text style={styles.amountNote}>Collected by the driver. You don't pay in the app.</Text>
          </View>
        </View>

        <View style={styles.optionsList}>
          {PAYMENT_METHODS.map((method) => {
            const isSelected = selectedMethod === method.id;
            return (
              <Pressable
                key={method.id}
                style={[styles.optionCard, isSelected && styles.optionCardSelected]}
                onPress={() => setSelectedMethod(method.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: isSelected }}
              >
                <View style={styles.optionIconBox}>
                  <MaterialIcons
                    name={method.icon}
                    size={24}
                    color={isSelected ? colors.primary : colors.onSurfaceVariant}
                  />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={styles.optionLabel}>{method.label}</Text>
                  <Text style={styles.optionDescription}>{method.description}</Text>
                </View>
                <View style={styles.radioContainer}>
                  <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.bottomActions}>
        <Button label="CONTINUE" onPress={handleContinue} variant="primary" fullWidth size="lg" />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    height: spacing.rowHeightStandard,
    backgroundColor: colors.surface,
    zIndex: 50,
  },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  helpButton: { paddingHorizontal: spacing.sm, height: 40, justifyContent: 'center' },
  helpButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  scrollContent: { padding: spacing.marginMobile, paddingTop: spacing.md, paddingBottom: spacing.xxxl * 2 },
  amountSection: { marginBottom: spacing.xl },
  sectionTitle: {
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    marginBottom: spacing.sm,
  },
  amountCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surfaceVariant,
    ...shadows.card,
  },
  amountLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginBottom: 4,
  },
  amountValue: { fontSize: 24, fontWeight: 'bold', color: colors.primary, fontFamily: typography.headlineMd.fontFamily },
  amountNote: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 4,
    textAlign: 'center',
  },
  optionsList: { gap: spacing.md },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 24,
    padding: spacing.md,
  },
  optionCardSelected: { borderColor: colors.primary, backgroundColor: colors.primary + '1A', borderWidth: 2 },
  optionIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  optionTextContainer: { flex: 1 },
  optionLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  optionDescription: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  radioContainer: { alignItems: 'center', justifyContent: 'center' },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: colors.primary, backgroundColor: colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.surface },
  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface + 'E6',
    padding: spacing.marginMobile,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
  },
});

export default PaymentMethodScreen;
