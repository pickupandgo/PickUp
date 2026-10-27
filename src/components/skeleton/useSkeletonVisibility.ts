import { useState, useEffect, useRef } from 'react';

declare const process: any;

const isTestEnv =
  typeof process !== 'undefined' &&
  Boolean(process?.env?.JEST_WORKER_ID);

export interface UseSkeletonVisibilityOptions {
  /**
   * Whether the asynchronous data request is currently pending.
   */
  readonly isLoading: boolean;
  /**
   * Whether usable data is already present (e.g. from cache or prior fetch).
   * If true, skeletons are NEVER displayed (preserves content during background refreshes).
   */
  readonly hasData?: boolean;
  /**
   * Milliseconds to wait before showing the skeleton to prevent visual flicker
   * when requests complete quickly. Defaults to 180ms (150–200ms range) in production,
   * or 0 in Jest test environment unless explicitly specified.
   */
  readonly delayMs?: number;
  /**
   * Maximum duration (ms) a skeleton is allowed to remain visible before timing out.
   * Prevents skeletons from hanging indefinitely if a network request drops.
   * Defaults to 10000ms.
   */
  readonly timeoutMs?: number;
  /**
   * Whether an error occurred. If true, skeleton is suppressed in favor of error state.
   */
  readonly isError?: boolean;
}

/**
 * Hook to intelligently manage skeleton loading visibility:
 * 1. Never show skeletons unconditionally (only when pending with NO usable data).
 * 2. Render cached data immediately; never display skeleton if data exists.
 * 3. Prevent flicker by delaying skeleton display by 150-200ms (default 180ms).
 * 4. Preserve existing content during background refreshes.
 * 5. Suppress skeletons when an error occurs so error/retry UI displays.
 * 6. Auto-timeout to prevent indefinite loading states on network drop.
 */
export function useSkeletonVisibility({
  isLoading,
  hasData = false,
  delayMs = isTestEnv ? 0 : 180,
  timeoutMs = 10000,
  isError = false,
}: UseSkeletonVisibilityOptions): boolean {
  const shouldConsider = isLoading && !hasData && !isError;
  const [showSkeleton, setShowSkeleton] = useState(() => delayMs === 0 && shouldConsider);

  const delayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!shouldConsider) {
      setShowSkeleton(false);
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
      return;
    }

    if (delayMs > 0) {
      const delayTimer = setTimeout(() => {
        setShowSkeleton(true);
      }, delayMs);
      if (typeof (delayTimer as any)?.unref === 'function') {
        (delayTimer as any).unref();
      }
      delayTimerRef.current = delayTimer;
    } else {
      setShowSkeleton(true);
    }

    const timeoutTimer = setTimeout(() => {
      setShowSkeleton(false);
    }, timeoutMs);
    if (typeof (timeoutTimer as any)?.unref === 'function') {
      (timeoutTimer as any).unref();
    }
    timeoutTimerRef.current = timeoutTimer;

    return () => {
      if (delayTimerRef.current) {
        clearTimeout(delayTimerRef.current);
        delayTimerRef.current = null;
      }
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
        timeoutTimerRef.current = null;
      }
    };
  }, [shouldConsider, delayMs, timeoutMs]);

  return shouldConsider && showSkeleton;
}
