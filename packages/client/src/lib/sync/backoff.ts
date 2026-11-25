const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 60_000;

/**
 * The caller reconnects after every error instead of EventSource retrying, since a ticket is
 * spent once used; this spaces those attempts while the server is down or redeploying.
 */
export const createBackoff = (retry: () => void) => {
  let delayMs = MIN_RETRY_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    /** Returns its delay, or null when one is already queued. */
    schedule: () => {
      if (timer !== null) return null;
      const scheduledMs = delayMs;
      timer = setTimeout(() => {
        timer = null;
        retry();
      }, scheduledMs);
      delayMs = Math.min(delayMs * 2, MAX_RETRY_MS);
      return scheduledMs;
    },
    cancel: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
    reset: () => {
      delayMs = MIN_RETRY_MS;
    },
  };
};
