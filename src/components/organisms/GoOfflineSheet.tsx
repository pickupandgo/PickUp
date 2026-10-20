import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Icon from '../atoms/Icon';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { PrimaryButton } from '../atoms/PrimaryButton';
import { SecondaryButton } from '../atoms/SecondaryButton';
import { useI18n } from '../../i18n';

export interface GoOfflineSheetProps {
  readonly onGoOffline: () => void;
  readonly onStayLive: () => void;
  readonly style?: ViewStyle;
  readonly testID?: string;
}

export const GoOfflineSheet: React.FC<GoOfflineSheetProps> = ({
  onGoOffline,
  onStayLive,
  style,
  testID,
}) => {
  const { t } = useI18n();

  return (
    <View style={[styles.container, style]} testID={testID} accessibilityRole="none">
      <View style={styles.iconContainer}>
        <Icon name="power_settings_new" style={styles.icon} />
      </View>
      <Text style={styles.title}>{t('home.goOfflineTitle')}</Text>
      <Text style={styles.description}>{t('home.goOfflineDesc')}</Text>
      <View style={styles.actions}>
        <PrimaryButton label={t('home.goOfflineBtn')} onPress={onGoOffline} style={styles.goOfflineButton} />
        <SecondaryButton label={t('home.stayLive')} onPress={onStayLive} style={styles.stayLiveButton} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surfaceContainerLowest,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    alignItems: 'center',
    gap: spacing.containerPadding,
    ...shadows.lg,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surfaceContainerLow,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 32,
    color: colors.primary,
  },
  title: {
    ...typography.headlineMd,
    color: colors.onSurface,
    textAlign: 'center',
  },
  description: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  actions: {
    width: '100%',
    gap: spacing.md,
  },
  goOfflineButton: {
    width: '100%',
  },
  stayLiveButton: {
    width: '100%',
  },
});

export default GoOfflineSheet;
