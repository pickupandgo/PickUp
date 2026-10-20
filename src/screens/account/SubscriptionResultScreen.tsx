import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import { useI18n } from '../../i18n';
import type { AccountScreenProps } from '../../types/navigation';

export interface SubscriptionResultScreenProps {
  readonly navigation: AccountScreenProps<'SubscriptionResult'>['navigation'];
  readonly route: AccountScreenProps<'SubscriptionResult'>['route'];
  readonly testID?: string;
}

export const SubscriptionResultScreen: React.FC<SubscriptionResultScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { success } = route.params;

  const handleDone = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  const handleRetry = useCallback(() => {
    navigation.navigate('SubscriptionProcessing');
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
          {success ? t('subscription.activatedTitle') : t('subscription.failedTitle')}
        </Text>

        <Text style={styles.subtitle}>
          {success
            ? t('subscription.activatedSubtitle')
            : t('subscription.failedSubtitle')}
        </Text>
      </View>

      <View style={styles.actions}>
        {success ? (
          <PrimaryButton label={t('subscription.startDriving')} onPress={handleDone} />
        ) : (
          <>
            <PrimaryButton label={t('common.retry')} onPress={handleRetry} />
            <SecondaryButton label={t('subscription.backToProfile')} onPress={handleDone} />
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
  subtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
  },
  actions: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    gap: spacing.gutter,
  },
});

export default SubscriptionResultScreen;
