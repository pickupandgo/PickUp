import React, { useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { useI18n } from '../../i18n';
import { AppHeader } from '../../components/molecules/AppHeader';
import { PrimaryButton } from '../../components/atoms/PrimaryButton';
import { SecondaryButton } from '../../components/atoms/SecondaryButton';
import type { AccountScreenProps } from '../../types/navigation';

export interface AccountRestrictedScreenProps {
  readonly navigation: AccountScreenProps<'AccountRestricted'>['navigation'];
  readonly testID?: string;
}

export const AccountRestrictedScreen: React.FC<AccountRestrictedScreenProps> = ({
  navigation,
  testID,
}) => {
  const { t } = useI18n();

  const handleContactSupport = useCallback(() => {
    // Mock: opens support chat/email in production
  }, []);

  const handleReviewGuidelines = useCallback(() => {
    // Mock: opens guidelines in production
  }, []);

  const restrictedActions = [
    t('accountRestricted.actionNoTrips'),
    t('accountRestricted.actionNoPayouts'),
  ];

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={t('accountRestricted.title')}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Restricted hero */}
        <View style={styles.heroCard}>
          <Icon name="gpp_bad" style={styles.heroIcon} />
          <Text style={styles.heroTitle}>{t('accountRestricted.title')}</Text>
          <Text style={styles.heroSubtitle}>{t('accountRestricted.subtitle')}</Text>
        </View>

        {/* Review details */}
        <View style={styles.detailCard}>
          <Text style={styles.detailTitle}>{t('accountRestricted.reviewDetails')}</Text>

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('accountRestricted.reason')}</Text>
            <Text style={styles.detailValue}>{t('accountRestricted.reasonText')}</Text>
          </View>

          <View style={styles.divider} />

          <Text style={styles.restrictedLabel}>{t('accountRestricted.restrictedActions')}</Text>
          {restrictedActions.map((action, idx) => (
            <View key={idx} style={styles.restrictedRow}>
              <Icon name="block" style={styles.restrictedIcon} />
              <Text style={styles.restrictedText}>{action}</Text>
            </View>
          ))}

          <View style={styles.divider} />

          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>{t('accountRestricted.status')}</Text>
            <Text style={styles.statusValue}>{t('accountRestricted.statusText')}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.actions}>
        <PrimaryButton
          label={t('accountRestricted.contactSupport')}
          onPress={handleContactSupport}
        />
        <SecondaryButton
          label={t('accountRestricted.reviewGuidelines')}
          onPress={handleReviewGuidelines}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    gap: spacing.containerPadding,
  },
  heroCard: {
    backgroundColor: colors.errorContainer,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.gutter,
  },
  heroIcon: {
    fontSize: 48,
    color: colors.error,
  },
  heroTitle: {
    ...typography.headlineMd,
    color: colors.error,
    textAlign: 'center',
  },
  heroSubtitle: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    textAlign: 'center',
    lineHeight: 22,
  },
  detailCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderRadius: borderRadius.md,
    padding: spacing.containerPadding,
    gap: spacing.gutter,
    ...shadows.sm,
  },
  detailTitle: {
    ...typography.headlineSm,
    color: colors.onSurface,
  },
  detailRow: {
    gap: 4,
  },
  detailLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    fontWeight: '600',
  },
  detailValue: {
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  divider: {
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  restrictedLabel: {
    ...typography.labelSm,
    color: colors.error,
    fontWeight: '600',
  },
  restrictedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  restrictedIcon: {
    fontSize: 16,
    color: colors.error,
  },
  restrictedText: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    flex: 1,
  },
  statusValue: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
    fontStyle: 'italic',
  },
  actions: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    paddingTop: spacing.gutter,
    gap: spacing.gutter,
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
  },
});

export default AccountRestrictedScreen;
