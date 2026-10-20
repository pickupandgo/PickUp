import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { useI18n } from '../../i18n';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * CancellationResultScreen
 * Shows cancellation success or failure result with action to return home.
 */
export interface CancellationResultScreenProps {
  readonly navigation: HomeScreenProps<'CancellationResult'>['navigation'];
  readonly route: HomeScreenProps<'CancellationResult'>['route'];
  readonly testID?: string;
}

export const CancellationResultScreen: React.FC<CancellationResultScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { success } = route.params;

  const handleDone = useCallback(() => {
    navigation.popToTop();
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.container}>
        <View style={[styles.icon, success ? styles.iconSuccess : styles.iconError]}>
          <Text style={styles.iconText}>
            {success ? 'check_circle' : 'error'}
          </Text>
        </View>
        <Text style={styles.title}>
          {success ? t('cancellation.successTitle') : t('cancellation.failureTitle')}
        </Text>
        <Text style={styles.subtitle}>
          {success ? t('cancellation.successSubtitle') : t('cancellation.failureSubtitle')}
        </Text>
      </View>

      <PrimaryButton
        label={t('common.backToHome')}
        onPress={handleDone}
        style={styles.doneButton}
      />
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
  doneButton: {
    marginHorizontal: spacing.containerPadding,
    marginBottom: spacing.lg,
  },
});

export default CancellationResultScreen;
