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

export interface CashPaymentStatusScreenProps {
  readonly amount?: string;
  readonly onContinue?: (method: string) => void;
  readonly onBack?: () => void;
}

const CASH_PAYMENT_METHODS = [
  { 
    id: 'cod', 
    label: 'Cash on Delivery', 
    subtitle: 'Pay with cash when package arrives', 
    icon: 'payments' as const 
  },
  { 
    id: 'cap', 
    label: 'Cash at Pickup', 
    subtitle: 'Pay at the store counter', 
    icon: 'storefront' as const 
  },
];

const CashPaymentStatusScreen: React.FC<CashPaymentStatusScreenProps & { navigation?: any }> = ({
  amount = '340',
  onContinue,
  onBack,
  navigation,
}) => {
  const [selectedMethod, setSelectedMethod] = useState<string>('cod');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Top App Bar */}
      <View style={styles.header}>
        <Pressable
          style={styles.iconButton}
          onPress={() => (onBack ? onBack() : navigation?.goBack())}
        >
          <Feather name="arrow-left" size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.headerTitle}>Payment</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Summary Card */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Total Amount</Text>
          <View style={styles.amountContainer}>
            <Text style={styles.currencySymbol}>₹</Text>
            <Text style={styles.amountValue}>{amount}</Text>
          </View>
        </View>

        {/* Payment Methods List */}
        <Text style={styles.sectionTitle}>Select Payment Method</Text>
        
        <View style={styles.optionsList}>
          {CASH_PAYMENT_METHODS.map((method) => {
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
                    color={isSelected ? colors.primary : colors.onSurfaceVariant}
                  />
                </View>
                
                <View style={styles.optionTextContainer}>
                  <Text style={[
                    styles.optionLabel,
                    isSelected && styles.optionLabelSelected
                  ]}>
                    {method.label}
                  </Text>
                  <Text style={styles.optionSubtitle}>
                    {method.subtitle}
                  </Text>
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
          label="CONFIRM PAYMENT METHOD"
          onPress={() => {
            onContinue?.(selectedMethod);
            navigation?.navigate('PaymentSuccessfulScreen');
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
    fontSize: typography.headlineMd.fontSize,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl * 2,
  },
  summaryCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.xl,
    ...shadows.card,
  },
  summaryLabel: {
    fontSize: typography.labelSm.fontSize,
    fontWeight: typography.labelSm.fontWeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    textTransform: 'uppercase',
    letterSpacing: typography.labelCaps.letterSpacing,
    marginBottom: spacing.xs,
  },
  amountContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  currencySymbol: {
    fontSize: typography.headlineSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.headlineSm.fontFamily,
    marginRight: 4,
    marginTop: 4,
  },
  amountValue: {
    fontSize: 40,
    fontWeight: 'bold',
    color: colors.primary,
    fontFamily: typography.headlineMd.fontFamily,
    lineHeight: 48,
  },
  sectionTitle: {
    fontSize: typography.headlineSm.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.headlineSm.fontFamily,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  optionsList: {
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  optionCardSelected: {
    borderColor: colors.primary,
  },
  optionIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  optionIconBoxSelected: {
    backgroundColor: colors.primaryContainer,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionLabel: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '600',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  optionLabelSelected: {
    color: colors.primary,
  },
  optionSubtitle: {
    fontSize: typography.labelSm.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.labelSm.fontFamily,
    marginTop: 2,
  },
  radioContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.outlineVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
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

export default CashPaymentStatusScreen;
