/**
 * Coalesces per-chunk download progress into a bounded update stream.
 *
 * Node-side single-file downloads (mods, content) stream in small chunks — on a fast
 * connection that's hundreds of progress events per second. Feeding every one into the
 * activity manager and IPC channel starves the renderer and makes progress look
 * frozen/janky. This wrapper emits at most one update per `intervalMs`, always keeps
 * the LATEST byte count, and guarantees the final (100%) value is delivered even if it
 * arrives faster than the interval.
 */
export interface ProgressCoalescer {
  /** Record a new byte count (throttled emission). */
  push(bytesDownloaded: number, totalBytes: number): void;
  /** Force-deliver the latest value (call once at completion). */
  flush(): void;
}

export function createProgressCoalescer(
  emit: (bytesDownloaded: number, totalBytes: number) => void,
  intervalMs = 75
): ProgressCoalescer {
  let latestBytes = 0;
  let latestTotal = 0;
  let lastEmitAt = 0;
  let timer: NodeJS.Timeout | null = null;

  function deliver(): void {
    timer = null;
    lastEmitAt = Date.now();
    emit(latestBytes, latestTotal);
  }

  function push(bytesDownloaded: number, totalBytes: number): void {
    latestBytes = bytesDownloaded;
    latestTotal = totalBytes;
    const now = Date.now();
    if (now - lastEmitAt >= intervalMs) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      deliver();
      return;
    }
    // Rate-limited: schedule a trailing edge so the final count still lands shortly
    // after the stream stops (and flush() can short-circuit it at completion).
    if (!timer) {
      const remaining = intervalMs - (now - lastEmitAt);
      timer = setTimeout(deliver, remaining);
    }
  }

  function flush(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    deliver();
  }

  return { push, flush };
}