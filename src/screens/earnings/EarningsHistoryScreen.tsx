import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  type ListRenderItem,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../../components/atoms/Icon';
import { StatusPill } from '../../components/atoms/StatusPill';
import { AppHeader } from '../../components/molecules/AppHeader';
import { InlineErrorBanner } from '../../components/molecules/InlineErrorBanner';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useI18n } from '../../i18n';
import { useDriverEarnings } from '../../hooks/useDriverEarnings';
import { formatRupees, paiseToRupees } from '../../services/payments/money';
import {
  EARNING_STATUSES,
  type EarningDto,
  type EarningStatusDto,
} from '../../services/payments/earningsDto';
import type { EarningsScreenProps } from '../../types/navigation';
import {
  bankNotice,
  EARNING_STATUS_VIEW,
  PAYOUT_STATUS_VIEW,
  shortDate,
  SUMMARY_TILES,
} from './earningsPresentation';

export interface EarningsHistoryScreenProps {
  readonly navigation: EarningsScreenProps<'EarningsHistory'>['navigation'];
  readonly testID?: string;
}

const money = (paise: number) => formatRupees(paiseToRupees(paise));
const RECENT_PAYOUTS = 3;

/**
 * The driver's earnings as the payments backend records them: what is payable in the next
 * weekly payout, what is still awaiting Razorpay's settlement, in payout, paid, on hold for
 * review, or kept as cash; each trip's breakdown; recent payouts and where they go. Nothing here
 * is computed on the phone, and the wallet balance is not earnings.
 */
export const EarningsHistoryScreen: React.FC<EarningsHistoryScreenProps> = ({
  testID,
}) => {
  const { t } = useI18n();
  const {
    available,
    summary,
    earnings,
    payouts,
    bankAccount,
    bankAccountKnown,
    filter,
    setFilter,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
  } = useDriverEarnings();
  const [expanded, setExpanded] = useState<string | null>(null);

  const handleRefresh = useCallback(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const handleEndReached = useCallback(() => {
    if (hasMore) {
      loadMore().catch(() => undefined);
    }
  }, [hasMore, loadMore]);

  const toggleFilter = useCallback(
    (status: EarningStatusDto | null) => {
      setExpanded(null);
      setFilter(status === filter ? null : status);
    },
    [filter, setFilter],
  );

  const notice = useMemo(() => bankNotice(bankAccount), [bankAccount]);

  const header = useMemo(
    () => (
      <View style={styles.headerContent}>
        {error ? (
          <InlineErrorBanner
            message={error}
            onRetry={handleRefresh}
            retryLabel={t('wallet.retry')}
          />
        ) : null}

        {/* Payable: what the next weekly payout carries */}
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>{t('earnings.payable')}</Text>
          {summary ? (
            <Text style={styles.heroValue}>{money(summary.payablePaise)}</Text>
          ) : isLoading ? (
            <ActivityIndicator
              style={styles.heroLoading}
              color={colors.onPrimary}
              accessibilityLabel={t('earnings.payable')}
            />
          ) : (
            <Text style={styles.heroValue}>—</Text>
          )}
          <Text style={styles.heroHint}>{t('earnings.payableNext')}</Text>
          {bankAccountKnown ? (
            <View style={styles.bankRow}>
              <Icon
                name={notice.ok ? 'account_balance' : 'info'}
                size={16}
                color={notice.ok ? colors.inversePrimary : colors.tertiaryFixed}
              />
              <Text
                style={[styles.bankText, !notice.ok && styles.bankTextWarn]}
              >
                {t(notice.key, notice.vars ? { ...notice.vars } : undefined)}
              </Text>
            </View>
          ) : null}
        </View>

        {/* The other states, each a filter */}
        <View style={styles.tiles}>
          {SUMMARY_TILES.map(tile => {
            const view = EARNING_STATUS_VIEW[tile.status];
            const selected = filter === tile.status;
            return (
              <Pressable
                key={tile.status}
                style={[styles.tile, selected && styles.tileSelected]}
                onPress={() => toggleFilter(tile.status)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityHint={t(view.hintKey)}
              >
                <View style={styles.tileHeader}>
                  <Icon
                    name={view.icon}
                    size={16}
                    color={colors.onSurfaceVariant}
                  />
                  <Text style={styles.tileLabel} numberOfLines={1}>
                    {t(view.labelKey)}
                  </Text>
                </View>
                <Text style={styles.tileValue}>
                  {summary ? money(summary[tile.field]) : '—'}
                </Text>
                <Text style={styles.tileHint} numberOfLines={2}>
                  {t(view.hintKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {summary ? (
          <Text style={styles.summaryLine}>
            {t('earnings.summaryLine', {
              count: summary.tripCount,
              gross: money(summary.grossPaise),
              fee: money(summary.platformFeePaise),
            })}
          </Text>
        ) : null}

        {/* Recent weekly payouts */}
        <Text style={styles.sectionTitle}>{t('earnings.payouts')}</Text>
        <View style={styles.card}>
          {payouts.length === 0 ? (
            <Text style={styles.emptyText}>{t('earnings.noPayouts')}</Text>
          ) : (
            payouts.slice(0, RECENT_PAYOUTS).map((payout, index, shown) => {
              const view = PAYOUT_STATUS_VIEW[payout.status];
              return (
                <View
                  key={payout.payoutId}
                  style={[
                    styles.payoutRow,
                    index < shown.length - 1 && styles.rowBorder,
                  ]}
                >
                  <View style={styles.flexShrink}>
                    <Text style={styles.rowTitle}>
                      {money(payout.amountPaise)}
                    </Text>
                    <Text style={styles.rowSub}>
                      {shortDate(payout.processedAt ?? payout.createdAt)} ·{' '}
                      {t('earnings.payoutTo', {
                        last4: payout.bankAccountLast4,
                      })}
                    </Text>
                    {payout.utr ? (
                      <Text style={styles.rowSub}>
                        {t('earnings.utr', { utr: payout.utr })}
                      </Text>
                    ) : null}
                  </View>
                  <StatusPill label={t(view.labelKey)} variant={view.variant} />
                </View>
              );
            })
          )}
        </View>

        {/* Per-trip list filter */}
        <Text style={styles.sectionTitle}>{t('earnings.history')}</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {[null, ...EARNING_STATUSES].map(status => {
            const selected = filter === status;
            return (
              <Pressable
                key={status ?? 'ALL'}
                style={[
                  styles.chip,
                  selected ? styles.chipSelected : styles.chipUnselected,
                ]}
                onPress={() => toggleFilter(status)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
              >
                <Text
                  style={[
                    styles.chipText,
                    selected
                      ? styles.chipTextSelected
                      : styles.chipTextUnselected,
                  ]}
                >
                  {status
                    ? t(EARNING_STATUS_VIEW[status].labelKey)
                    : t('earnings.filterAll')}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    ),
    [
      error,
      handleRefresh,
      t,
      summary,
      isLoading,
      bankAccountKnown,
      notice,
      filter,
      toggleFilter,
      payouts,
    ],
  );

  const renderItem: ListRenderItem<EarningDto> = useCallback(
    ({ item }) => {
      const view = EARNING_STATUS_VIEW[item.status];
      const open = expanded === item.earningId;
      return (
        <Pressable
          style={styles.earningRow}
          onPress={() => setExpanded(open ? null : item.earningId)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
        >
          <View style={styles.earningMain}>
            <View style={styles.earningIcon}>
              <Icon
                name={view.icon}
                size={20}
                color={colors.onSurfaceVariant}
              />
            </View>
            <View style={styles.flexShrink}>
              <Text style={styles.rowTitle}>
                {t('earnings.trip', { date: shortDate(item.createdAt) })}
              </Text>
              <StatusPill
                label={t(view.labelKey)}
                variant={view.variant}
                style={styles.rowPill}
              />
            </View>
            <View style={styles.earningRight}>
              <Text style={styles.earningAmount}>
                {money(item.netAmountPaise)}
              </Text>
              <Icon
                name={open ? 'expand_less' : 'expand_more'}
                size={20}
                color={colors.outline}
              />
            </View>
          </View>
          {open ? (
            <View style={styles.breakdown}>
              <BreakdownLine
                label={t('earnings.fare')}
                value={money(item.grossAmountPaise)}
              />
              <BreakdownLine
                label={t('earnings.platformFee')}
                value={`−${money(item.platformFeePaise)}`}
              />
              {item.otherDeductionsPaise > 0 ? (
                <BreakdownLine
                  label={t('earnings.otherDeductions')}
                  value={`−${money(item.otherDeductionsPaise)}`}
                />
              ) : null}
              {item.tdsAmountPaise > 0 ? (
                <BreakdownLine
                  label={t('earnings.tds')}
                  value={`−${money(item.tdsAmountPaise)}`}
                />
              ) : null}
              <BreakdownLine
                label={t('earnings.yourEarning')}
                value={money(item.netAmountPaise)}
                strong
              />
              <Text style={styles.rowSub}>{t(view.hintKey)}</Text>
              {item.payableAt && item.status === 'PAYABLE' ? (
                <Text style={styles.rowSub}>
                  {t('earnings.payableSince', {
                    date: shortDate(item.payableAt),
                  })}
                </Text>
              ) : null}
              {item.paidAt ? (
                <Text style={styles.rowSub}>
                  {t('earnings.paidOn', { date: shortDate(item.paidAt) })}
                </Text>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      );
    },
    [expanded, t],
  );

  const footer = useMemo(
    () =>
      isLoadingMore ? (
        <ActivityIndicator
          style={styles.footerLoading}
          color={colors.primary}
        />
      ) : undefined,
    [isLoadingMore],
  );

  const empty = useMemo(
    () =>
      isLoading ? (
        <ActivityIndicator
          style={styles.footerLoading}
          color={colors.primary}
        />
      ) : (
        <Text style={[styles.emptyText, styles.emptyList]}>
          {t('earnings.emptyList')}
        </Text>
      ),
    [isLoading, t],
  );

  if (!available) {
    return (
      <SafeAreaView style={styles.safeArea} testID={testID}>
        <AppHeader title={t('earnings.title')} showBackButton={false} />
        <View style={styles.headerContent}>
          <InlineErrorBanner message={t('earnings.unavailable')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top']}>
      <AppHeader title={t('earnings.title')} showBackButton={false} />
      <FlatList
        data={earnings}
        keyExtractor={item => item.earningId}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        ListEmptyComponent={empty}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={styles.listContent}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
            tintColor={colors.primary}
          />
        }
      />
    </SafeAreaView>
  );
};

const Separator: React.FC = () => <View style={styles.separator} />;

const BreakdownLine: React.FC<{
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}> = ({ label, value, strong = false }) => (
  <View style={styles.breakRow}>
    <Text style={strong ? styles.breakLabelStrong : styles.breakLabel}>
      {label}
    </Text>
    <Text style={strong ? styles.breakValueStrong : styles.breakValue}>
      {value}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  listContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.xxl,
  },
  headerContent: {
    gap: spacing.gutter,
    paddingBottom: spacing.gutter,
    paddingHorizontal: 0,
  },
  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    gap: spacing.unit,
    marginTop: spacing.xs,
  },
  heroLabel: {
    ...typography.labelCaps,
    color: colors.inversePrimary,
  },
  heroValue: {
    ...typography.displaySm,
    color: colors.onPrimary,
  },
  heroLoading: {
    alignSelf: 'flex-start',
    height: 36,
  },
  heroHint: {
    ...typography.labelSm,
    color: colors.inversePrimary,
  },
  bankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.primaryContainer,
  },
  bankText: {
    ...typography.labelSm,
    color: colors.inversePrimary,
    flex: 1,
  },
  bankTextWarn: {
    color: colors.tertiaryFixed,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.lg,
    padding: spacing.gutter,
    gap: spacing.unit,
  },
  tileSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.unit,
  },
  tileLabel: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    flexShrink: 1,
  },
  tileValue: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  tileHint: {
    ...typography.labelSm,
    fontSize: 11,
    color: colors.outline,
  },
  summaryLine: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
    paddingHorizontal: spacing.unit,
  },
  sectionTitle: {
    ...typography.headlineSm,
    color: colors.primary,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.unit,
  },
  card: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.xs,
  },
  payoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.gutter,
    paddingVertical: spacing.gutter,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.outlineVariant,
  },
  flexShrink: {
    flexShrink: 1,
    flexGrow: 1,
  },
  rowTitle: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.primary,
  },
  rowSub: {
    ...typography.labelSm,
    color: colors.onSurfaceVariant,
  },
  rowPill: {
    marginTop: spacing.unit,
  },
  chips: {
    gap: spacing.xs,
    paddingHorizontal: spacing.unit,
  },
  chip: {
    paddingHorizontal: spacing.gutter,
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
  earningRow: {
    backgroundColor: colors.surfaceContainerLowest,
    borderWidth: 1,
    borderColor: colors.outlineVariant,
    borderRadius: borderRadius.lg,
    padding: spacing.gutter,
    gap: spacing.gutter,
  },
  earningMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.gutter,
  },
  earningIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  earningRight: {
    alignItems: 'flex-end',
    gap: spacing.unit,
  },
  earningAmount: {
    ...typography.dataMono,
    color: colors.primary,
  },
  breakdown: {
    borderTopWidth: 1,
    borderTopColor: colors.outlineVariant,
    paddingTop: spacing.xs,
    gap: spacing.unit,
  },
  breakRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  breakLabel: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  breakValue: {
    ...typography.dataMono,
    color: colors.onSurface,
  },
  breakLabelStrong: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  breakValueStrong: {
    ...typography.headlineSm,
    color: colors.primary,
  },
  separator: {
    height: spacing.xs,
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.outline,
    paddingVertical: spacing.gutter,
  },
  emptyList: {
    textAlign: 'center',
  },
  footerLoading: {
    paddingVertical: spacing.lg,
  },
});

export default EarningsHistoryScreen;
