import type { LeaderElection } from "@tanstack/offline-transactions";

const LOCK = "offline-executor-leader";

/**
 * The tab that sends the outbox, one per origin. The library's own election asks once and gives
 * up when another tab leads, so once the first tab closed, no tab sent anything until a reload.
 * This one waits in line for the lock, and takes over the moment the leader goes.
 */
const createTabLeader = (): LeaderElection => {
  let leading = false;
  let release: (() => void) | null = null;
  const listeners = new Set<(isLeader: boolean) => void>();

  const hold = () => {
    leading = true;
    return new Promise<void>((resolve) => {
      release = resolve;
    });
  };

  return {
    async requestLeadership() {
      if (leading) return true;
      const granted = await new Promise<boolean>((answer) => {
        void navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
          answer(lock !== null);
          return lock ? hold() : undefined;
        });
      });
      if (!granted)
        void navigator.locks.request(LOCK, () => {
          const held = hold();
          for (const listener of listeners) listener(true);
          return held;
        });
      return granted;
    },
    releaseLeadership() {
      if (!release) return;
      leading = false;
      for (const listener of listeners) listener(false);
      release();
      release = null;
    },
    isLeader: () => leading,
    onLeadershipChange(listener) {
      listeners.add(listener);
      // Granted before this subscriber arrived; the executor ignores a repeat of what it knows
      if (leading) queueMicrotask(() => listener(true));
      return () => listeners.delete(listener);
    },
  };
};

/** Undefined where there are no Web Locks, which leaves the library its BroadcastChannel election. */
export const tabLeader = () =>
  typeof navigator !== "undefined" && "locks" in navigator ? createTabLeader() : undefined;
