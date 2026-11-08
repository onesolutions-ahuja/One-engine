export type PollingHost = {
  visible: () => boolean;
  subscribe: (callback: () => void) => () => void;
  schedule: (callback: () => void, delay: number) => unknown;
  cancel: (timer: unknown) => void;
};

/** Refresh authorised read models without superseding a slow in-flight read.
 * The delay starts after completion; returning to the page refreshes immediately.
 * Callers own result disposal when their query or authenticated session changes. */
export function startVisiblePolling(
  load: () => Promise<void>,
  onError: (error: unknown) => void,
  intervalMs = 5000,
  host: PollingHost = {
    visible: () => document.visibilityState === 'visible',
    subscribe: callback => {
      document.addEventListener('visibilitychange', callback);
      window.addEventListener('online', callback);
      return () => {
        document.removeEventListener('visibilitychange', callback);
        window.removeEventListener('online', callback);
      };
    },
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancel: timer => window.clearTimeout(timer as number)
  }
): () => void {
  let stopped = false;
  let running = false;
  let requested = false;
  let timer: unknown;
  const clearTimer = () => {
    if (timer !== undefined) host.cancel(timer);
    timer = undefined;
  };
  const refresh = async () => {
    clearTimer();
    if (stopped || !host.visible()) return;
    if (running) { requested = true; return; }
    running = true;
    try { await load(); }
    catch (error) { if (!stopped) onError(error); }
    finally {
      running = false;
      if (!stopped && host.visible()) {
        const delay = requested ? 0 : intervalMs;
        requested = false;
        timer = host.schedule(() => { timer = undefined; void refresh(); }, delay);
      }
    }
  };
  const unsubscribe = host.subscribe(() => {
    if (host.visible()) void refresh();
    else { clearTimer(); requested = false; }
  });
  void refresh();
  return () => { stopped = true; clearTimer(); unsubscribe(); };
}
