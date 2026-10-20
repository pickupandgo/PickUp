import React, { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { useI18n } from '../../i18n';
import type { HomeScreenProps } from '../../types/navigation';

/**
 * CancellationProcessingScreen
 * Loading screen shown while cancellation is being processed.
 */
export interface CancellationProcessingScreenProps {
  readonly navigation: HomeScreenProps<'CancellationProcessing'>['navigation'];
  readonly route: HomeScreenProps<'CancellationProcessing'>['route'];
  readonly testID?: string;
}

export const CancellationProcessingScreen: React.FC<CancellationProcessingScreenProps> = ({
  navigation,
  route,
  testID,
}) => {
  const { t } = useI18n();
  const { tripId, reason } = route.params;

  useEffect(() => {
    // Mock processing delay — will be replaced with API call
    const timer = setTimeout(() => {
      // Simulate success
      navigation.navigate('CancellationResult', {
        tripId,
        success: true,
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [navigation, tripId]);

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <View style={styles.container}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.title}>{t('cancellation.processingTitle')}</Text>
        <Text style={styles.subtitle}>{t('cancellation.processingSubtitle')}</Text>
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

export default CancellationProcessingScreen;
