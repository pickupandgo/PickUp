import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getPaymentsApi } from '../services/payments';
import type {
  BankAccountDto,
  EarningDto,
  EarningStatusDto,
  EarningsSummaryDto,
  PayoutDto,
} from '../services/payments/earningsDto';
import { describePaymentsError } from '../services/payments/paymentsErrors';

const PAGE_SIZE = 20;

export interface UseDriverEarningsResult {
  /** False when this build has no payments backend configured. */
  readonly available: boolean;
  readonly summary: EarningsSummaryDto | null;
  readonly earnings: readonly EarningDto[];
  readonly payouts: readonly PayoutDto[];
  readonly bankAccount: BankAccountDto | null;
  /** True once the bank account has been looked up (null then means "none linked"). */
  readonly bankAccountKnown: boolean;
  readonly filter: EarningStatusDto | null;
  readonly setFilter: (filter: EarningStatusDto | null) => void;
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly isLoadingMore: boolean;
  readonly hasMore: boolean;
  /** Driver-safe message for the last failed load. Earlier data is kept. */
  readonly error: string | null;
  readonly refresh: () => Promise<void>;
  readonly loadMore: () => Promise<void>;
}

/**
 * The driver's earnings from the payments backend: totals per state, the per-trip list
 * (optionally one state only), recent weekly payouts and the payout bank account. Reloaded
 * whenever the screen comes into focus. Every number and state is the server's.
 */
export function useDriverEarnings(): UseDriverEarningsResult {
  const [summary, setSummary] = useState<EarningsSummaryDto | null>(null);
  const [earnings, setEarnings] = useState<readonly EarningDto[]>([]);
  const [payouts, setPayouts] = useState<readonly PayoutDto[]>([]);
  const [bankAccount, setBankAccount] = useState<BankAccountDto | null>(null);
  const [bankAccountKnown, setBankAccountKnown] = useState(false);
  const [filter, setFilterState] = useState<EarningStatusDto | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only the latest load may update state, so a slow earlier response never wins.
  const generation = useRef(0);
  const mounted = useRef(false);
  const loadingMore = useRef(false);
  const filterRef = useRef<EarningStatusDto | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (userInitiated: boolean, listOnly = false) => {
    const api = getPaymentsApi();
    if (!api) {
      return;
    }
    generation.current += 1;
    const current = generation.current;
    const isCurrent = () => mounted.current && current === generation.current;
    const status = filterRef.current ?? undefined;
    if (userInitiated) {
      setIsRefreshing(true);
    }
    setIsLoading(true);
    try {
      const [page, nextSummary, nextPayouts, nextBank] = await Promise.all([
        api.listEarnings({ status, limit: PAGE_SIZE }),
        listOnly ? Promise.resolve(null) : api.getEarningsSummary(),
        listOnly ? Promise.resolve(null) : api.listPayouts(),
        listOnly ? Promise.resolve(undefined) : api.getBankAccount(),
      ]);
      if (!isCurrent()) {
        return;
      }
      setEarnings(page.items);
      setNextCursor(page.nextCursor);
      if (nextSummary) {
        setSummary(nextSummary);
      }
      if (nextPayouts) {
        setPayouts(nextPayouts);
      }
      if (nextBank !== undefined) {
        setBankAccount(nextBank);
        setBankAccountKnown(true);
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
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(false).catch(() => undefined);
    }, [load]),
  );

  const setFilter = useCallback(
    (next: EarningStatusDto | null) => {
      filterRef.current = next;
      setFilterState(next);
      setEarnings([]);
      setNextCursor(null);
      load(false, true).catch(() => undefined);
    },
    [load],
  );

  const refresh = useCallback(() => load(true), [load]);

  const loadMore = useCallback(async () => {
    const api = getPaymentsApi();
    if (!api || !nextCursor || loadingMore.current) {
      return;
    }
    loadingMore.current = true;
    const current = generation.current;
    const isCurrent = () => mounted.current && current === generation.current;
    setIsLoadingMore(true);
    try {
      const page = await api.listEarnings({
        status: filterRef.current ?? undefined,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      if (!isCurrent()) {
        return; // A reload or a new filter replaced the list meanwhile.
      }
      setEarnings(previous => {
        const seen = new Set(previous.map(item => item.earningId));
        return [
          ...previous,
          ...page.items.filter(item => !seen.has(item.earningId)),
        ];
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
  }, [nextCursor]);

  return {
    available: getPaymentsApi() !== null,
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
    hasMore: nextCursor !== null,
    error,
    refresh,
    loadMore,
  };
}
