import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { mockEarningsSummary } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { useEarnings } from '../../hooks/useEarnings';
import { useI18n } from '../../i18n';
import type { EarningsScreenProps } from '../../types/navigation';

type PeriodTab = 'today' | 'weekly' | 'monthly';

export interface EarningsHistoryScreenProps {
  readonly navigation: EarningsScreenProps<'EarningsHistory'>['navigation'];
  readonly testID?: string;
}

interface HistoryEntry {
  readonly id: string;
  readonly time: string;
  readonly amount: number;
}

const HISTORY: readonly HistoryEntry[] = [
  { id: 'LOG-8492', time: 'Today, 2:45 PM', amount: 142.5 },
  { id: 'LOG-8491', time: 'Today, 1:15 PM', amount: 110 },
  { id: 'LOG-8488', time: 'Today, 11:30 AM', amount: 95 },
];

export const EarningsHistoryScreen: React.FC<EarningsHistoryScreenProps> = ({ navigation, testID }) => {
  const { t } = useI18n();
  const { summary: liveSummary, fetchSummary } = useEarnings();
  const [activeTab, setActiveTab] = useState<PeriodTab>('today');

  const summary = liveSummary ?? mockEarningsSummary;
  const currency = summary.currency ?? '₹';

  const money = useCallback(
    (n: number) =>
      `${currency}${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    [currency],
  );

  const cash = summary.cashEarnings ?? mockEarningsSummary.cashEarnings ?? 0;
  const online = summary.onlineEarnings ?? mockEarningsSummary.onlineEarnings ?? 0;
  const hours = summary.onlineHours ?? mockEarningsSummary.onlineHours ?? 0;

  const handleTab = useCallback(
    (tab: PeriodTab) => {
      setActiveTab(tab);
      fetchSummary(tab === 'today' ? 'day' : tab === 'weekly' ? 'week' : 'month');
    },
    [fetchSummary],
  );

  const handleTripPress = useCallback(
    (tripId: string) => navigation.navigate('TripEarningsDetail', { tripId }),
    [navigation],
  );

  const tabs: { key: PeriodTab; label: string }[] = useMemo(
    () => [
      { key: 'today', label: t('earnings.today') },
      { key: 'weekly', label: t('earnings.weekly') },
      { key: 'monthly', label: t('earnings.monthly') },
    ],
    [t],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader title={t('earnings.title')} showBackButton={false} />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Tabs */}
        <View style={styles.tabRow}>
          {tabs.map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                style={[styles.chip, selected ? styles.chipSelected : styles.chipUnselected]}
                onPress={() => handleTab(tab.key)}
              >
                <Text style={[styles.chipText, selected ? styles.chipTextSelected : styles.chipTextUnselected]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Summary card */}
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t('earnings.total')}</Text>
          <Text style={styles.summaryValue}>{money(summary.totalEarnings)}</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCol}>
              <Text style={styles.gridLabel}>{t('earnings.trips')}</Text>
              <Text style={styles.gridValue}>{summary.totalTrips}</Text>
            </View>
            <View style={styles.summaryCol}>
              <Text style={styles.gridLabel}>{t('earnings.online')}</Text>
              <Text style={styles.gridValue}>{t('earnings.hrs', { value: hours })}</Text>
            </View>
          </View>
        </View>

        {/* Breakdown */}
        <Text style={styles.sectionTitle}>{t('earnings.breakdown')}</Text>
        <View style={styles.card}>
          <View style={styles.breakRow}>
            <Text style={styles.breakLabel}>{t('earnings.cash')}</Text>
            <Text style={styles.breakValue}>{money(cash)}</Text>
          </View>
          <View style={styles.breakRow}>
            <Text style={styles.breakLabel}>{t('earnings.onlineEarnings')}</Text>
            <Text style={styles.breakValue}>{money(online)}</Text>
          </View>
          <View style={styles.breakRow}>
            <Text style={[styles.breakLabel, styles.errorText]}>{t('earnings.commission')}</Text>
            <Text style={[styles.breakValue, styles.errorText]}>-{money(summary.platformCommission)}</Text>
          </View>
          <View style={[styles.breakRow, styles.netRow]}>
            <Text style={styles.netLabel}>{t('earnings.net')}</Text>
            <Text style={styles.netValue}>{money(summary.netEarnings)}</Text>
          </View>
        </View>

        {/* History */}
        <Text style={styles.sectionTitle}>{t('earnings.history')}</Text>
        <View style={styles.card}>
          {HISTORY.map((entry, i) => (
            <Pressable
              key={entry.id}
              style={[styles.historyRow, i < HISTORY.length - 1 && styles.historyRowBorder]}
              onPress={() => handleTripPress(entry.id)}
            >
              <View style={styles.historyLeft}>
                <View style={styles.historyIcon}>
                  <Icon name="local_taxi" size={20} color={colors.onSurfaceVariant} />
                </View>
                <View>
                  <Text style={styles.historyId}>Trip ID: {entry.id}</Text>
                  <Text style={styles.historyTime}>{entry.time}</Text>
                </View>
              </View>
              <Text style={styles.historyAmount}>{money(entry.amount)}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.containerPadding,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  chipSelected: {
    backgroundColor: colors.primary,
  },
  chipUnselected: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
  },
  chipText: {
    ...typography.labelSm,
  },
  chipTextSelected: {
    color: colors.onPrimary,
  },
  chipTextUnselected: {
    color: colors.onSurfaceVariant,
  },
  summaryCard: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
  },
  summaryLabel: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
    marginBottom: spacing.xs,
  },
  summaryValue: {
    fontFamily: typography.headlineMd.fontFamily,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: spacing.containerPadding,
  },
  summaryGrid: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    paddingTop: spacing.containerPadding,
  },
  summaryCol: {
    flex: 1,
  },
  gridLabel: {
    ...typography.labelCaps,
    color: colors.onSurfaceVariant,
  },
  gridValue: {
    ...typography.headlineMd,
    color: colors.primary,
    marginTop: 4,
  },
  sectionTitle: {
    ...typography.headlineSm,
    color: colors.primary,
    marginBottom: -spacing.xs,
    marginLeft: spacing.unit,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
    padding: spacing.containerPadding,
  },
  breakRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  breakLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  breakValue: {
    ...typography.dataMono,
    color: colors.primary,
  },
  errorText: {
    color: colors.error,
  },
  netRow: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    marginTop: spacing.xs,
    paddingTop: spacing.sm,
  },
  netLabel: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  netValue: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.gutter,
  },
  historyRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyId: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.primary,
  },
  historyTime: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  historyAmount: {
    ...typography.dataMono,
    fontWeight: '500',
    color: colors.primary,
  },
});

export default EarningsHistoryScreen;
