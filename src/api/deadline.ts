/** Bounds a complete asynchronous operation, even if a provider ignores AbortSignal. */
export const withDeadline = async <T>(
  timeoutMs: number,
  external: AbortSignal | undefined,
  error: (reason: 'timeout' | 'cancelled') => Error,
  work: (signal: AbortSignal, check: () => void) => Promise<T>,
): Promise<T> => {
  if (external?.aborted) throw error('cancelled');
  const controller = new AbortController();
  let failure: Error | undefined;
  let rejectWait!: (reason: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectWait = reject;
  });
  const stop = (reason: 'timeout' | 'cancelled') => {
    if (failure) return;
    failure = error(reason);
    rejectWait(failure);
    controller.abort();
  };
  const cancel = () => stop('cancelled');
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  external?.addEventListener('abort', cancel);
  const check = () => {
    if (failure) throw failure;
  };
  try {
    if (external?.aborted) cancel();
    return await Promise.race([
      interrupted,
      (async () => {
        check();
        return work(controller.signal, check);
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', cancel);
  }
};
