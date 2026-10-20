import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { useI18n } from '../../i18n';
import type { AccountScreenProps } from '../../types/navigation';

export interface SubscriptionProcessingScreenProps {
  readonly navigation: AccountScreenProps<'SubscriptionProcessing'>['navigation'];
  readonly testID?: string;
}

export const SubscriptionProcessingScreen: React.FC<SubscriptionProcessingScreenProps> = ({
  navigation,
  testID,
}) => {
  const { t } = useI18n();

  useEffect(() => {
    // Mock processing — replaced with payment gateway
    const timer = setTimeout(() => {
      const success = Math.random() > 0.2;
      navigation.navigate('SubscriptionResult', { success });
    }, 2500);
    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.title}>{t('subscription.processingTitle')}</Text>
        <Text style={styles.subtitle}>{t('subscription.processingSubtitle')}</Text>
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
});

export default SubscriptionProcessingScreen;
