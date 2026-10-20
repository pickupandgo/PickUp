import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import type { ListRenderItemInfo } from 'react-native';
import Icon from '../../components/atoms/Icon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, typography, spacing } from '../../theme';
import { walletLabels } from '../../data/mockData';
import { AppHeader } from '../../components/molecules/AppHeader';
import { InlineErrorBanner } from '../../components/molecules/InlineErrorBanner';
import { TransactionRow } from '../../components/molecules/TransactionRow';
import { TabChip } from '../../components/atoms/TabChip';
import { useWallet } from '../../hooks/useWallet';
import { TRANSACTION_ICON } from './transactionIcons';
import type { Transaction } from '../../types/wallet';
import type { WalletScreenProps } from '../../types/navigation';

type FilterTab = 'all' | 'credit' | 'debit';

export interface TransactionHistoryScreenProps {
  readonly navigation: WalletScreenProps<'TransactionHistory'>['navigation'];
  readonly testID?: string;
}

const Separator: React.FC = () => <View style={styles.separator} />;

export const TransactionHistoryScreen: React.FC<
  TransactionHistoryScreenProps
> = ({ navigation, testID }) => {
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const {
    balance,
    transactions,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMore,
    error,
    refresh,
    loadMore,
  } = useWallet();

  const filteredTransactions = useMemo(
    () =>
      activeTab === 'all'
        ? transactions
        : transactions.filter(txn => txn.type === activeTab),
    [activeTab, transactions],
  );
  const firstLoad = isLoading && balance === null;

  const handleRefresh = useCallback(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const handleEndReached = useCallback(() => {
    if (hasMore) {
      loadMore().catch(() => undefined);
    }
  }, [hasMore, loadMore]);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Transaction>) => (
      <TransactionRow
        title={item.title}
        description={item.description}
        amount={item.amount}
        currency={item.currency}
        type={item.type}
        date={item.time ? `${item.date}, ${item.time}` : item.date}
        iconName={TRANSACTION_ICON[item.category]}
      />
    ),
    [],
  );

  const renderEmpty = useCallback(() => {
    if (firstLoad) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      );
    }
    if (error && transactions.length === 0) {
      // The error banner above the list explains what went wrong.
      return null;
    }
    return (
      <View style={styles.emptyContainer}>
        <Icon name="receipt_long" style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>No Transactions</Text>
        <Text style={styles.emptySubtitle}>
          {activeTab === 'credit'
            ? 'No credits yet.'
            : activeTab === 'debit'
            ? 'No debits yet.'
            : 'Your transaction history will appear here.'}
        </Text>
      </View>
    );
  }, [activeTab, error, firstLoad, transactions.length]);

  const renderFooter = useCallback(
    () =>
      isLoadingMore ? (
        <ActivityIndicator
          style={styles.footerSpinner}
          color={colors.primary}
        />
      ) : null,
    [isLoadingMore],
  );

  return (
    <SafeAreaView style={styles.safeArea} testID={testID}>
      <AppHeader
        title={walletLabels.transactionHistoryTitle}
        onBackPress={() => navigation.goBack()}
        showBackButton
      />

      {/* Filter tabs */}
      <View style={styles.tabRow}>
        <TabChip
          label="All"
          selected={activeTab === 'all'}
          onPress={() => setActiveTab('all')}
        />
        <TabChip
          label="Credits"
          selected={activeTab === 'credit'}
          onPress={() => setActiveTab('credit')}
        />
        <TabChip
          label="Debits"
          selected={activeTab === 'debit'}
          onPress={() => setActiveTab('debit')}
        />
      </View>

      {error ? (
        <InlineErrorBanner
          message={error}
          onRetry={handleRefresh}
          style={styles.errorBanner}
        />
      ) : null}

      <FlatList
        data={filteredTransactions}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        ItemSeparatorComponent={Separator}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.containerPadding,
    paddingVertical: spacing.gutter,
  },
  errorBanner: {
    marginHorizontal: spacing.containerPadding,
    marginBottom: spacing.xs,
  },
  listContent: {
    paddingHorizontal: spacing.containerPadding,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  separator: {
    height: 1,
    backgroundColor: colors.outlineVariant,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg * 2,
    gap: spacing.xs,
  },
  emptyIcon: {
    fontSize: 48,
    color: colors.outline,
  },
  emptyTitle: {
    ...typography.headlineSm,
    color: colors.onSurfaceVariant,
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.outline,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  footerSpinner: {
    paddingVertical: spacing.containerPadding,
  },
});

export default TransactionHistoryScreen;
