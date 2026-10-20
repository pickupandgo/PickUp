import React, { useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { mockPaymentMethods, PaymentMethod } from '../../data/mockData';
import { useI18n } from '../../i18n';
import TopAppBar from '../../components/organisms/TopAppBar';
import Card from '../../components/molecules/Card';
import Divider from '../../components/atoms/Divider';
import Button from '../../components/atoms/Button';

export interface PaymentSelectionScreenProps {
  readonly onBack?: () => void;
  readonly onSelect?: (paymentId: string) => void;
}

const PaymentSelectionScreen: React.FC<PaymentSelectionScreenProps & { navigation?: any }> = ({
  onBack,
  onSelect,
  navigation,
}) => {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState<string>(
    mockPaymentMethods.find((m) => m.isDefault)?.id ?? ''
  );

  const getMethodLabel = (method: PaymentMethod) => {
    if (method.type === 'upi') return t('payment.googlePay');
    if (method.type === 'card') return t('payment.creditCard');
    if (method.type === 'cash') return t('payment.cash');
    return method.label;
  };

  const getMethodDetail = (method: PaymentMethod) => {
    if (method.type === 'cash') return t('payment.payOnDelivery');
    return method.detail;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopAppBar
        title={t('payment.selectPayment')}
        leadingIcon={<Text style={styles.backIcon}>←</Text>}
        onLeadingPress={() => (onBack ? onBack() : navigation?.goBack())}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Card variant="outlined" padding="none">
          {mockPaymentMethods.map((method, index) => {
            const label = getMethodLabel(method);
            const detail = getMethodDetail(method);
            return (
              <React.Fragment key={method.id}>
                {index > 0 && <Divider />}
                <Pressable
                  style={[
                    styles.paymentRow,
                    selectedId === method.id && styles.paymentRowSelected,
                  ]}
                  onPress={() => {
                    setSelectedId(method.id);
                    onSelect?.(method.id);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: selectedId === method.id }}
                >
                  <View style={styles.paymentIcon}>
                    <Text style={styles.paymentIconText}>
                      {method.type === 'upi' ? '🏦' : method.type === 'card' ? '💳' : '💵'}
                    </Text>
                  </View>
                  <View style={styles.paymentInfo}>
                    <Text style={styles.paymentLabel}>{label}</Text>
                    <Text style={styles.paymentDetail}>{detail}</Text>
                  </View>
                  <View
                    style={[
                      styles.radio,
                      selectedId === method.id && styles.radioSelected,
                    ]}
                  >
                    {selectedId === method.id && (
                      <View style={styles.radioInner} />
                    )}
                  </View>
                </Pressable>
              </React.Fragment>
            );
          })}
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={t('common.continue')}
          onPress={() => navigation?.navigate('PaymentMethodScreen')}
          variant="primary"
          size="lg"
          fullWidth
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
  backIcon: {
    fontSize: 22,
    color: colors.onSurface,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.marginMobile,
    gap: spacing.stackGapMd,
    paddingBottom: spacing.xxxl,
  },

  // Payment Row
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  paymentRowSelected: {
    backgroundColor: colors.surfaceContainerLow,
  },
  paymentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentIconText: { fontSize: 18 },
  paymentInfo: {
    flex: 1,
    gap: 2,
  },
  paymentLabel: {
    fontSize: typography.bodyLg.fontSize,
    fontWeight: '500',
    color: colors.onSurface,
    fontFamily: typography.bodyLg.fontFamily,
  },
  paymentDetail: {
    fontSize: typography.bodyMd.fontSize,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyMd.fontFamily,
  },

  // Radio
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.primary,
  },

  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.outlineHairline,
    backgroundColor: colors.surface,
  },
});

export default PaymentSelectionScreen;
