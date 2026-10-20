import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { useI18n } from '../../i18n';
import type { WalletScreenProps } from '../../types/navigation';

export interface RechargeProcessingScreenProps {
  readonly navigation: WalletScreenProps<'RechargeProcessing'>['navigation'];
  readonly route: WalletScreenProps<'RechargeProcessing'>['route'];
  readonly testID?: string;
}

export const RechargeProcessingScreen: React.FC<RechargeProcessingScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { amount } = route.params;

  useEffect(() => {
    // Mock processing — replaced with payment gateway integration
    const timer = setTimeout(() => {
      // Simulate success (80%) or failure (20%)
      const success = Math.random() > 0.2;
      navigation.navigate('RechargeResult', {
        success,
        amount: success ? amount : undefined,
      });
    }, 2500);

    return () => clearTimeout(timer);
  }, [navigation, amount]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.title}>{t('wallet.processingTitle')}</Text>
        <Text style={styles.subtitle}>{t('wallet.processingSubtitle')}</Text>
        <Text style={styles.amount}>₹{amount.toLocaleString()}</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.containerPadding,
    paddingHorizontal: spacing.lg,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  amount: {
    ...typography.headlineLg,
    color: colors.primary,
    marginTop: spacing.xs,
  },
});

export default RechargeProcessingScreen;
