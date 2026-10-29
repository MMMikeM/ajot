export type SyncState = "disconnected" | "connecting" | "connected";

/**
 * A single failed attempt still reads as reconnecting: a stopped Fly machine answers its first
 * request with a 502 while it resumes. Once a retry has failed too, sync reads as offline until
 * the stream opens again, rather than pulsing "Syncing…" through every backoff retry.
 */
const FAILURES_BEFORE_OFFLINE = 2;

export const trackSyncState = (onChange: (state: SyncState) => void) => {
  let state: SyncState = "disconnected";
  let failures = 0;

  const set = (next: SyncState) => {
    if (next === state) return;
    state = next;
    onChange(next);
  };
  const reconnectingOrOffline = () =>
    set(failures < FAILURES_BEFORE_OFFLINE && navigator.onLine ? "connecting" : "disconnected");

  return {
    get: () => state,
    /** A fresh start (sign-in, back online), not a backoff retry: earlier failures no longer count. */
    restart: () => {
      failures = 0;
    },
    connecting: reconnectingOrOffline,
    opened: () => {
      failures = 0;
      set("connected");
    },
    failed: () => {
      failures++;
      reconnectingOrOffline();
    },
    stopped: () => set("disconnected"),
  };
};
