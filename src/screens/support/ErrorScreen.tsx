import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, borderRadius, typography } from '../../theme';
import Button from '../../components/atoms/Button';
import { useI18n } from '../../i18n';

export interface ErrorScreenProps {
  readonly variant: 'noInternet' | 'serverUnavailable' | 'connectionLost';
  readonly onRetry?: () => void;
  readonly onGoBack?: () => void;
}

const iconMap = {
  noInternet: '📡',
  serverUnavailable: '🔧',
  connectionLost: '🔌',
} as const;

const titleKeyMap = {
  noInternet: 'errors.noInternet',
  serverUnavailable: 'errors.serverUnavailable',
  connectionLost: 'errors.connectionLost',
} as const;

const subtitleKeyMap = {
  noInternet: 'errors.noInternetSubtitle',
  serverUnavailable: 'errors.serverUnavailableSubtitle',
  connectionLost: 'errors.connectionLostSubtitle',
} as const;

const ErrorScreen: React.FC<ErrorScreenProps & { navigation?: any }> = ({
  variant,
  onRetry,
  onGoBack,
  navigation,
}) => {
  const { t } = useI18n();

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>{iconMap[variant]}</Text>
        </View>
        <Text style={styles.title}>{t(titleKeyMap[variant])}</Text>
        <Text style={styles.subtitle}>{t(subtitleKeyMap[variant])}</Text>
      </View>

      <View style={styles.footer}>
        <Button
          label={t('common.retry')}
          onPress={() => (onRetry ? onRetry() : navigation?.goBack())}
          variant="primary"
          size="lg"
          fullWidth
        />
        <Button
          label={t('common.goBack')}
          onPress={() => (onGoBack ? onGoBack() : navigation?.goBack())}
          variant="ghost"
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xxxl,
    gap: spacing.lg,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  icon: {
    fontSize: 44,
  },
  title: {
    fontSize: typography.headlineMd.fontSize,
    lineHeight: typography.headlineMd.lineHeight,
    fontWeight: typography.headlineMd.fontWeight,
    color: colors.onSurface,
    fontFamily: typography.headlineMd.fontFamily,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.bodyLg.fontSize,
    lineHeight: typography.bodyLg.lineHeight,
    color: colors.onSurfaceVariant,
    fontFamily: typography.bodyLg.fontFamily,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.marginMobile,
    paddingBottom: spacing.xxxl,
    gap: spacing.sm,
  },
});

export default ErrorScreen;
