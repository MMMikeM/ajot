import {
  IndexedDBAdapter,
  LocalStorageAdapter,
  type StorageAdapter,
} from "@tanstack/offline-transactions";

const JOURNAL_PREFIX = "outbox-journal:";

const journalKey = (key: string) => `${JOURNAL_PREFIX}${key}`;

const journalKeys = () =>
  Object.keys(localStorage)
    .filter((key) => key.startsWith(JOURNAL_PREFIX))
    .map((key) => key.slice(JOURNAL_PREFIX.length));

const writeJournal = (key: string, value: string) => {
  try {
    localStorage.setItem(journalKey(key), value);
    return true;
  } catch (err) {
    console.warn("[outbox] journal write failed:", err);
    return false;
  }
};

/** A queued transaction as the library stores it, which keeps its metadata at the top. */
type StoredTransaction = { metadata?: unknown };

export type OutboxStorage = StorageAdapter & {
  /**
   * Saves an edit for another tab, the leader, to send: in localStorage alone, where it has
   * landed by the time this returns. Its IndexedDB write could commit after the leader had sent
   * the edit and removed it, which queued it to be sent again.
   */
  keep: (key: string, value: string) => Promise<void>;
};

/**
 * The outbox in IndexedDB, each write also kept in localStorage until IndexedDB has committed it.
 * A page that unloads aborts its IndexedDB transactions still in flight, so a change made just
 * before a reload or a closed tab was lost; a localStorage write has landed by the time `set`
 * returns its promise. Without IndexedDB, localStorage holds the outbox on its own, as the
 * library's own fallback does. A transaction `isVisible` turns down stays stored but isn't
 * listed, so the executor neither shows nor sends it.
 */
const journaledStorage = (isVisible: (stored: StoredTransaction) => boolean): OutboxStorage => {
  const durable = IndexedDBAdapter.probe().then(({ available }) =>
    available ? new IndexedDBAdapter() : null,
  );

  const get = async (key: string) =>
    localStorage.getItem(journalKey(key)) ?? (await (await durable)?.get(key)) ?? null;

  const listed = async (key: string) => {
    const value = await get(key);
    if (value === null) return false;
    try {
      return isVisible(JSON.parse(value) as StoredTransaction);
    } catch {
      // Left for the library, which reports what it can't read
      return true;
    }
  };

  const set = async (key: string, value: string) => {
    const journaled = writeJournal(key, value);
    const store = await durable;
    if (!store) {
      if (!journaled) throw new Error("No storage for the outbox");
      return;
    }
    await store.set(key, value);
    // A later write to the same key has its own journal entry to clear
    if (localStorage.getItem(journalKey(key)) === value) localStorage.removeItem(journalKey(key));
  };

  return {
    get,
    set,
    async keep(key, value) {
      if (!writeJournal(key, value)) await set(key, value);
    },
    async delete(key) {
      localStorage.removeItem(journalKey(key));
      await (await durable)?.delete(key);
    },
    async keys() {
      const stored = (await (await durable)?.keys()) ?? [];
      const keys = [...new Set([...stored, ...journalKeys()])];
      const shown = await Promise.all(keys.map(listed));
      return keys.filter((_, i) => shown[i]);
    },
    async clear() {
      for (const key of journalKeys()) localStorage.removeItem(journalKey(key));
      await (await durable)?.clear();
    },
  };
};

/** Another tab queued an edit: the `storage` event of its journal write. */
export const isQueuedElsewhere = (event: StorageEvent) =>
  event.newValue !== null && !!event.key?.startsWith(JOURNAL_PREFIX);

/** Undefined leaves the choice to the library, which runs online-only with no storage at all. */
export const createOutboxStorage = (isVisible: (stored: StoredTransaction) => boolean) =>
  LocalStorageAdapter.probe().available ? journaledStorage(isVisible) : undefined;
