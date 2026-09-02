import React, { useState } from 'react';
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

export interface PaymentMethodScreenProps {
  readonly amount?: string;
  readonly onContinue?: (method: string) => void;
  readonly onBack?: () => void;
  readonly onHelp?: () => void;
}

const PAYMENT_METHODS = [
  { id: 'cod', label: 'Cash on Delivery (COD)', icon: 'payments' as const },
  { id: 'pickup', label: 'Cash at Pickup', icon: 'local-atm' as const },
  { id: 'upi', label: 'Pay via UPI', icon: 'account-balance' as const },
];

const PaymentMethodScreen: React.FC<PaymentMethodScreenProps & { navigation?: any }> = ({
  amount = '₹ 450.00',
  onContinue,
  onBack,
  onHelp,
  navigation,
}) => {
  const [selectedMethod, setSelectedMethod] = useState<string>('upi');

  const CASH_METHOD_IDS = ['cod', 'pickup'];

  const handleContinue = () => {
    onContinue?.(selectedMethod);
    navigation?.navigate(
      CASH_METHOD_IDS.includes(selectedMethod)
        ? 'CashPaymentStatusScreen'
        : 'PaymentMethodSelectedScreen'
    );
  };

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
        <Text style={styles.headerTitle}>Delivery</Text>
        <Pressable
          style={styles.helpButton}
          onPress={() => (onHelp ? onHelp() : navigation?.navigate('ActiveTripChatScreen'))}
        >
          <Text style={styles.helpButtonText}>Help</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header & Amount */}
        <View style={styles.amountSection}>
          <Text style={styles.sectionTitle}>Payment Method</Text>
          <View style={styles.amountCard}>
            <Text style={styles.amountLabel}>Amount to pay</Text>
            <Text style={styles.amountValue}>{amount}</Text>
          </View>
        </View>

        {/* Payment Options */}
        <View style={styles.optionsList}>
          {PAYMENT_METHODS.map((method) => {
            const isSelected = selectedMethod === method.id;

            return (
              <Pressable
                key={method.id}
                style={[
                  styles.optionCard,
                  isSelected && styles.optionCardSelected,
                ]}
                onPress={() => setSelectedMethod(method.id)}
              >
                <View
                  style={[
                    styles.optionIconBox,
                    isSelected && styles.optionIconBoxSelected,
                  ]}
                >
                  <MaterialIcons
                    name={method.icon}
                    size={24}
                    color={isSelected ? colors.onPrimary : colors.onSurfaceVariant}
                  />
                </View>
                <View style={styles.optionTextContainer}>
                  <Text style={styles.optionLabel}>{method.label}</Text>
                </View>
                <View style={styles.radioContainer}>
                  <View
                    style={[
                      styles.radioOuter,
                      isSelected && styles.radioOuterSelected,
                    ]}
                  >
                    {isSelected && <View style={styles.radioInner} />}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Fixed Bottom Action */}
      <View style={styles.bottomActions}>
        <Button
          label="CONTINUE"
          onPress={handleContinue}
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
    color: colors.primary,
    fontFamily: typography.headlineSm.fontFamily,
  },
  helpButton: {
    paddingHorizontal: spacing.sm,
    height: 40,
    justifyContent: 'center',
  },
  helpButtonText: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.primary,
    fontFamily: typography.labelSm.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl * 2,
  },
  amountSection: {
    marginBottom: spacing.xl,
  },
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
  amountValue: {
    fontSize: 24, // Custom large text
    fontWeight: 'bold',
    color: colors.primary, // Using primary since primary-container equivalent
    fontFamily: typography.headlineMd.fontFamily,
  },
  optionsList: {
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: 24,
    padding: spacing.md,
  },
  optionCardSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '1A', // 10% opacity roughly mapping to bg-primary-fixed/30
    borderWidth: 2,
  },
  optionIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  optionIconBoxSelected: {
    backgroundColor: colors.primary,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: typography.headlineSm.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
  },
  radioContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
  bottomActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface + 'E6', // 90% opacity
    padding: spacing.marginMobile,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceVariant,
  },
});

export default PaymentMethodScreen;
