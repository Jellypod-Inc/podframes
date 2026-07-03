/**
 * Bounded retry with exponential backoff for paid provider calls. Retries are
 * safe here because every call site is idempotent-by-artifact: the result is
 * only written to disk on success, so a retried call can never double-write.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; onRetry?: (err: unknown, attempt: number) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 1500;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      opts.onRetry?.(err, attempt);
      await new Promise((r) => setTimeout(r, base * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}

/** Reject with a clear message if `promise` outlives `ms`. The underlying work is
 *  not cancelled (most provider SDKs offer no abort) — but the pipeline stops
 *  waiting, fails the stage, and the per-file cache ignores partial results. */
export function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}
