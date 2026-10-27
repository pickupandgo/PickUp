import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuth } from '@react-native-firebase/auth';
import {
  WalletService,
  type WalletMode,
} from '../services/wallet/WalletService';
import { describePaymentsError } from '../services/payments/paymentsErrors';
import type { WalletBalance, Transaction } from '../types/wallet';

export interface UseWalletOptions {
  /** Also load the transaction history (default true). The home screen only needs the balance. */
  readonly includeTransactions?: boolean;
}

export interface UseWalletResult {
  readonly balance: WalletBalance | null;
  readonly transactions: readonly Transaction[];
  /** A load is in flight. Show a full-screen loader only while `balance` is still null. */
  readonly isLoading: boolean;
  /** A pull-to-refresh is in flight. */
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly hasMore: boolean;
  /** Driver-safe message for the last failed load, or null. Earlier data is kept on failure. */
  readonly error: string | null;
  readonly mode: WalletMode;
  readonly refresh: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
}

/**
 * The signed-in driver's wallet. Reloads whenever the screen comes into focus, so the balance is
 * fresh after a recharge or when returning to the app's wallet tab.
 */
export function useWallet(options: UseWalletOptions = {}): UseWalletResult {
  const includeTransactions = options.includeTransactions ?? true;
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<readonly Transaction[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uid = getAuth().currentUser?.uid;
  const cacheKey = uid ? `driver.wallet.${uid}` : null;

  // Each load gets a number; only the latest one may update state, so a slow earlier
  // response can never overwrite newer data.
  const generation = useRef(0);
  const mounted = useRef(false);
  const loadingMore = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!cacheKey) return;
    AsyncStorage.getItem(cacheKey)
      .then((raw) => {
        if (!mounted.current || !raw) return;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.balance === 'number') {
            setBalance(parsed);
          }
        } catch {
          // ignore cache error
        }
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, [cacheKey]);

  const load = useCallback(
    async (userInitiated: boolean) => {
      generation.current += 1;
      const current = generation.current;
      const isCurrent = () => mounted.current && current === generation.current;
      if (userInitiated) {
        setIsRefreshing(true);
      }
      setIsLoading(true);
      try {
        const service = WalletService.getInstance();
        const [nextBalance, page] = await Promise.all([
          service.getBalance(),
          includeTransactions
            ? service.getTransactions()
            : Promise.resolve(null),
        ]);
        if (!isCurrent()) {
          return;
        }
        setBalance(nextBalance);
        if (cacheKey && nextBalance) {
          AsyncStorage.setItem(cacheKey, JSON.stringify(nextBalance)).catch(() => {});
        }
        if (page) {
          setTransactions(page.items);
          setNextCursor(page.nextCursor);
        }
        setError(null);
      } catch (err: unknown) {
        if (isCurrent()) {
          setError(describePaymentsError(err));
        }
      } finally {
        if (isCurrent()) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [cacheKey, includeTransactions],
  );

  useFocusEffect(
    useCallback(() => {
      load(false).catch(() => undefined);
    }, [load]),
  );

  const refresh = useCallback(() => load(true), [load]);

  const loadMore = useCallback(async () => {
    if (!includeTransactions || !nextCursor || loadingMore.current) {
      return;
    }
    loadingMore.current = true;
    const current = generation.current;
    const isCurrent = () => mounted.current && current === generation.current;
    setIsLoadingMore(true);
    try {
      const page = await WalletService.getInstance().getTransactions(
        nextCursor,
      );
      if (!isCurrent()) {
        return; // A reload replaced the list while this page was loading.
      }
      setTransactions(previous => {
        const seen = new Set(previous.map(txn => txn.id));
        return [...previous, ...page.items.filter(txn => !seen.has(txn.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err: unknown) {
      if (isCurrent()) {
        setError(describePaymentsError(err));
      }
    } finally {
      loadingMore.current = false;
      if (mounted.current) {
        setIsLoadingMore(false);
      }
    }
  }, [includeTransactions, nextCursor]);

  return {
    balance,
    transactions,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMore: includeTransactions && nextCursor !== null,
    error,
    mode: WalletService.getMode(),
    refresh,
    loadMore,
  };
}
