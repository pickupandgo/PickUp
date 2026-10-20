import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { useI18n } from '../../i18n';
import type { WalletScreenProps } from '../../types/navigation';

export interface RechargeResultScreenProps {
  readonly navigation: WalletScreenProps<'RechargeResult'>['navigation'];
  readonly route: WalletScreenProps<'RechargeResult'>['route'];
  readonly testID?: string;
}

export const RechargeResultScreen: React.FC<RechargeResultScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { success, amount } = route.params;

  const handleDone = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  const handleRetry = useCallback(() => {
    navigation.navigate('Recharge');
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.container}>
        <View style={[styles.icon, success ? styles.iconSuccess : styles.iconError]}>
          <Text style={[styles.iconText, !success && styles.iconTextError]}>
            {success ? 'check_circle' : 'error'}
          </Text>
        </View>

        <Text style={styles.title}>
          {success ? t('wallet.successTitle') : t('wallet.failureTitle')}
        </Text>

        {success && amount != null ? (
          <Text style={styles.amount}>₹{amount.toLocaleString()}</Text>
        ) : (
          <Text style={styles.subtitle}>{t('wallet.failureSubtitle')}</Text>
        )}

        {success ? (
          <Text style={styles.successHint}>{t('wallet.successHint')}</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {success ? (
          <PrimaryButton label={t('common.done')} onPress={handleDone} />
        ) : (
          <>
            <PrimaryButton label={t('common.retry')} onPress={handleRetry} />
            <SecondaryButton label={t('wallet.backToWallet')} onPress={handleDone} />
          </>
        )}
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
  icon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSuccess: {
    backgroundColor: '#e8f5e9',
  },
  iconError: {
    backgroundColor: colors.errorContainer,
  },
  iconText: {
    fontSize: 40,
    color: '#2e7d32',
  },
  iconTextError: {
    color: colors.error,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  amount: {
    ...typography.headlineLg,
    color: colors.primary,
  },
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  successHint: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
  },
  actions: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    gap: spacing.gutter,
  },
});

export default RechargeResultScreen;
