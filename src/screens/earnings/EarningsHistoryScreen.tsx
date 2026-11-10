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
import { HomeBrandMark } from '../../components/molecules/HomeArtwork';
import { InlineErrorBanner } from '../../components/molecules/InlineErrorBanner';
import { colors } from '../../theme';
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
  testID, navigation,
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
  const handleHelp = useCallback(() => navigation.navigate('Support'), [navigation]);

  const header = useMemo(() => (
    <View style={styles.headerContent}>
      {error ? <InlineErrorBanner message={error} onRetry={handleRefresh} retryLabel={t('wallet.retry')} /> : null}
      <View style={styles.heroCard}>
        <View style={styles.heroMain}>
          <View style={styles.heroTop}>
            <Text style={styles.heroLabel}>Available for payout</Text>
            <Icon name="account_balance" size={28} color={colors.homeGreen} />
          </View>
          {summary ? <Text style={styles.heroValue}>{money(summary.payablePaise)}</Text> : isLoading ?
            <ActivityIndicator style={styles.heroLoading} color={colors.homeGreen} accessibilityLabel={t('earnings.payable')} /> :
            <Text style={styles.heroValue}>{'\u2014'}</Text>}
          <Text style={styles.heroHint}>Your eligible bank payout balance</Text>
        </View>
        {bankAccountKnown ? <View style={styles.bankRow}>
          <Icon name={notice.ok ? 'account_balance' : 'info_outline'} size={19} color={notice.ok ? colors.homeGreen : colors.warning} />
          <Text style={styles.bankText}>
            {bankAccount ? t(notice.key, notice.vars ? { ...notice.vars } : undefined) : 'Bank account not linked'}
          </Text>
          {!notice.ok && <Pressable onPress={handleHelp} style={styles.helpLink} accessibilityRole="button" accessibilityLabel="Get help with bank account setup">
            <Text style={styles.helpLabel}>Get help</Text>
          </Pressable>}
        </View> : null}
      </View>

      <View style={styles.tiles}>
        {SUMMARY_TILES.filter(tile => tile.status !== 'SETTLED_IN_CASH').map((tile, index) => {
          const view = EARNING_STATUS_VIEW[tile.status];
          const selected = filter === tile.status;
          return <Pressable key={tile.status} onPress={() => toggleFilter(tile.status)} accessibilityRole="button"
            accessibilityState={{ selected }} accessibilityHint={t(view.hintKey)}
            style={[styles.tile, index % 2 === 0 && styles.tileLeft, index < 2 && styles.tileTop, selected && styles.tileSelected]}>
            <Text style={styles.tileLabel}>{tile.status === 'PAID' ? 'Paid to bank' : t(view.labelKey)}</Text>
            <Text style={styles.tileValue}>{summary ? money(summary[tile.field]) : '\u2014'}</Text>
          </Pressable>;
        })}
      </View>

      <Pressable style={styles.cashCard} onPress={() => toggleFilter('SETTLED_IN_CASH')}
        accessibilityRole="button" accessibilityState={{ selected: filter === 'SETTLED_IN_CASH' }}
        accessibilityHint={t('earnings.cashKeptHint')}>
        <View style={styles.cashIcon}><Icon name="account_balance_wallet" size={27} color={colors.homeGreen} /></View>
        <View style={styles.cashContent}>
          <View style={styles.cashHeading}>
            <Text style={styles.cashLabel}>Cash collected</Text>
            <Text style={styles.cashAmount}>{summary ? money(summary.settledInCashPaise) : '\u2014'}</Text>
          </View>
          <Text style={styles.rowSub}>Kept by you; fees deducted from wallet.</Text>
          {summary ? <Text style={styles.summaryLine}>{t('earnings.summaryLine', {
            count: summary.tripCount, gross: money(summary.grossPaise), fee: money(summary.platformFeePaise),
          })}</Text> : null}
        </View>
      </Pressable>

      <View style={styles.payoutSection}>
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>{t('earnings.payouts')}</Text>
          {payouts.length === 0 && <Text style={styles.rowSub}>{t('earnings.noPayouts')}</Text>}
        </View>
        {payouts.slice(0, RECENT_PAYOUTS).map(payout => {
          const view = PAYOUT_STATUS_VIEW[payout.status];
          return <View key={payout.payoutId} style={styles.payoutRow}>
            <View style={styles.flexShrink}>
              <Text style={styles.rowTitle}>{money(payout.amountPaise)}</Text>
              <Text style={styles.rowSub}>{shortDate(payout.processedAt ?? payout.createdAt)} {'\u00b7'} {t('earnings.payoutTo', { last4: payout.bankAccountLast4 })}</Text>
              {payout.utr ? <Text style={styles.rowSub}>{t('earnings.utr', { utr: payout.utr })}</Text> : null}
            </View>
            <StatusPill label={t(view.labelKey)} variant={view.variant} />
          </View>;
        })}
      </View>

      <View style={styles.historyHeader}>
        <Text style={styles.historyTitle}>Trip earnings</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {[null, 'SETTLED_IN_CASH' as const, ...EARNING_STATUSES.filter(status => status !== 'SETTLED_IN_CASH')].map(status => (
            <Pressable key={status ?? 'ALL'} onPress={() => toggleFilter(status)} accessibilityRole="button"
              accessibilityState={{ selected: filter === status }} hitSlop={{ top: 6, bottom: 6 }}
              style={[styles.chip, filter === status ? styles.chipSelected : styles.chipUnselected]}>
              <Text style={[styles.chipText, filter === status ? styles.chipTextSelected : styles.chipTextUnselected]}>
                {status === 'SETTLED_IN_CASH' ? 'Cash' : status ? t(EARNING_STATUS_VIEW[status].labelKey) : t('earnings.filterAll')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  ), [error, handleRefresh, handleHelp, t, summary, isLoading, bankAccount, bankAccountKnown, notice, filter, toggleFilter, payouts]);

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
                color={item.status === 'SETTLED_IN_CASH' ? colors.homeGreen : colors.onSurfaceMuted}
              />
            </View>
            <View style={styles.flexShrink}>
              <Text style={styles.rowTitle}>
                {t('earnings.trip', { date: shortDate(item.createdAt) })}
              </Text>
              <Text style={styles.rowSub}>{item.status === 'SETTLED_IN_CASH' ? 'Cash kept by you' : t(view.labelKey)}</Text>
            </View>
            <Text style={styles.earningAmount}>{money(item.netAmountPaise)}</Text>
            <Icon name={open ? 'expand_less' : 'expand_more'} size={20} color={colors.onSurfaceMuted} />
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
      <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'left', 'right']}>
        <EarningsHeader onHelp={handleHelp} />
        <View style={styles.headerContent}>
          <InlineErrorBanner message={t('earnings.unavailable')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} testID={testID} edges={['top', 'left', 'right']}>
      <EarningsHeader onHelp={handleHelp} />
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

function EarningsHeader({ onHelp }: { onHelp: () => void }) {
  return <View style={styles.screenHeader}>
    <HomeBrandMark /><View style={styles.brandDivider} />
    <Text style={styles.screenTitle}>Earnings</Text>
    <Pressable onPress={onHelp} accessibilityRole="button" accessibilityLabel="Earnings help" style={styles.headerButton}>
      <Icon name="help_outline" size={23} color={colors.primary} />
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surfaceContainerLowest },
  screenHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 20, minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.homeBorder },
  brandDivider: { width: 1, height: 24, backgroundColor: colors.homeBorder },
  screenTitle: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: '600', color: colors.primary },
  headerButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 20, paddingBottom: 28 },
  headerContent: { gap: 24, paddingTop: 20, paddingBottom: 12 },
  heroCard: { borderWidth: 1, borderColor: colors.homeBorder, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.surfaceContainerLowest },
  heroMain: { backgroundColor: colors.homeLandscape, paddingHorizontal: 16, paddingVertical: 16, gap: 6 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroLabel: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500', color: colors.onSurfaceMuted },
  heroValue: { fontSize: 26, lineHeight: 33, fontWeight: '600', color: colors.primary },
  heroLoading: { alignSelf: 'flex-start', height: 33 },
  heroHint: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  bankRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingLeft: 16, paddingRight: 8, paddingVertical: 3, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.homeBorder },
  bankText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  helpLink: { minHeight: 44, minWidth: 60, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center' },
  helpLabel: { fontSize: 12, lineHeight: 18, fontWeight: '600', color: colors.homeGreen },
  tiles: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: { width: '50%', paddingHorizontal: 10, paddingVertical: 14, minHeight: 68, gap: 5 },
  tileTop: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.homeBorder },
  tileLeft: { borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.homeBorder },
  tileSelected: { backgroundColor: colors.homeMint },
  tileLabel: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  tileValue: { fontSize: 18, lineHeight: 24, fontWeight: '500', color: colors.primary },
  cashCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 12, backgroundColor: colors.surfaceContainerLow },
  cashIcon: { paddingTop: 4 },
  cashContent: { flex: 1, minWidth: 0, gap: 4 },
  cashHeading: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 10, rowGap: 4 },
  cashLabel: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.primary },
  cashAmount: { fontSize: 18, lineHeight: 24, fontWeight: '600', color: colors.primary },
  summaryLine: { fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted },
  payoutSection: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.homeBorder, paddingBottom: 18 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  sectionTitle: { fontSize: 14, lineHeight: 20, fontWeight: '500', color: colors.primary },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 14 },
  flexShrink: { flexShrink: 1, flexGrow: 1, minWidth: 0, gap: 4 },
  rowTitle: { fontSize: 13, lineHeight: 19, fontWeight: '500', color: colors.primary },
  rowSub: { fontSize: 11, lineHeight: 17, color: colors.onSurfaceMuted },
  historyHeader: { gap: 16 },
  historyTitle: { fontSize: 16, lineHeight: 22, fontWeight: '600', color: colors.primary },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { borderRadius: 8, minHeight: 28, paddingHorizontal: 12, paddingVertical: 5 },
  chipSelected: { backgroundColor: colors.primary, borderWidth: 1, borderColor: colors.primary },
  chipUnselected: { borderWidth: 1, borderColor: colors.outlineVariant },
  chipText: { fontSize: 11, lineHeight: 16 },
  chipTextSelected: { color: colors.onPrimary },
  chipTextUnselected: { color: colors.onSurfaceVariant },
  earningRow: { paddingVertical: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.homeBorder },
  earningMain: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  earningIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  earningAmount: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.primary, flexShrink: 1 },
  breakdown: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.homeBorder, paddingTop: 12, gap: 8 },
  breakRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  breakLabel: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted },
  breakValue: { fontSize: 12, lineHeight: 18, color: colors.primary, flexShrink: 1 },
  breakLabelStrong: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.primary },
  breakValueStrong: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.primary, flexShrink: 1 },
  separator: { height: 0 },
  emptyText: { fontSize: 12, lineHeight: 18, color: colors.onSurfaceMuted, paddingVertical: 20 },
  emptyList: { textAlign: 'center' },
  footerLoading: { paddingVertical: 20 },
});

export default EarningsHistoryScreen;
