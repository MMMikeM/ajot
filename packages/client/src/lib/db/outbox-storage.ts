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

// The adapter's defaults, named so the reads below open the same store
const OUTBOX_DB = "offline-transactions";
const OUTBOX_STORE = "transactions";

/**
 * Reads of the outbox's IndexedDB store that reject when IndexedDB fails. The adapter's own answer
 * a failure as nothing stored, and an edit missing from the outbox is one the leader has sent, so
 * every tab would settle its unsent edits.
 */
const strictReads = () => {
  let opening: Promise<IDBDatabase> | undefined;
  const open = () =>
    (opening ??= new Promise((resolve, reject) => {
      // Whichever of this and the adapter opens it first creates the store, so both make it alike
      const request = indexedDB.open(OUTBOX_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(OUTBOX_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const ask = async <T>(query: (store: IDBObjectStore) => IDBRequest<T>) => {
    try {
      const db = await open();
      return await new Promise<T>((resolve, reject) => {
        const request = query(db.transaction(OUTBOX_STORE).objectStore(OUTBOX_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (err) {
      // A connection the browser lost stays lost: the next read opens another
      const lost = opening;
      opening = undefined;
      void lost?.then((db) => db.close(), () => {});
      throw err;
    }
  };
  return {
    get: async (key: string) =>
      ((await ask((store) => store.get(key))) as string | undefined) ?? null,
    keys: async () => (await ask((store) => store.getAllKeys())) as string[],
  };
};

/** A queued transaction as the library stores it, which keeps its metadata at the top. */
type StoredTransaction = { metadata?: unknown };

export type OutboxStorage = StorageAdapter & {
  /**
   * Saves an edit for another tab, the leader, to send: in localStorage alone, as it's called. Its
   * IndexedDB write could commit after the leader had sent the edit and removed it, which would
   * queue it to be sent again. Resolves false if it didn't fit there and had to wait for IndexedDB.
   */
  keep: (key: string, value: string) => Promise<boolean>;
  /**
   * What `keys` lists from localStorage alone, for when IndexedDB can't be read: never an answer
   * to whether an edit was sent, only edits there are to send.
   */
  journaledKeys: () => string[];
};

/**
 * The outbox in IndexedDB, each write also kept in localStorage until IndexedDB has committed it.
 * A page that unloads aborts its IndexedDB transactions still in flight, so a change made just
 * before a reload or a closed tab would be lost; a localStorage write has landed by the time `set`
 * returns its promise. Without IndexedDB, localStorage holds the outbox on its own, as the
 * library's own fallback does. A transaction `isVisible` turns down stays stored but isn't
 * listed, so the executor neither shows nor sends it.
 */
const journaledStorage = (isVisible: (stored: StoredTransaction) => boolean): OutboxStorage => {
  const durable = IndexedDBAdapter.probe().then(({ available }) =>
    available ? new IndexedDBAdapter(OUTBOX_DB, OUTBOX_STORE) : null,
  );
  const strict = durable.then((store) => (store ? strictReads() : null));

  // The executor reads a transaction on its own only to rewrite it as it settles, and a rejection
  // there stops it sending until the page reloads; a missing one it already handles
  const read = async (key: string) =>
    localStorage.getItem(journalKey(key)) ?? (await (await durable)?.get(key)) ?? null;

  const readStrictly = async (key: string) =>
    localStorage.getItem(journalKey(key)) ?? (await (await strict)?.get(key)) ?? null;

  // `keys` reads each transaction to see whose it is, and the library then reads each one it
  // listed: that second read takes the first's value instead of going back to IndexedDB
  const listedValues = new Map<string, string>();

  const listed = async (key: string) => listedAs(key, await readStrictly(key));

  const listedAs = (key: string, value: string | null) => {
    if (value === null) return false;
    try {
      if (!isVisible(JSON.parse(value) as StoredTransaction)) return false;
    } catch {
      // Left for the library, which reports what it can't read
    }
    listedValues.set(key, value);
    return true;
  };

  const set = async (key: string, value: string) => {
    listedValues.delete(key);
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
    async get(key) {
      const value = listedValues.get(key);
      listedValues.delete(key);
      return value ?? read(key);
    },
    set,
    async keep(key, value) {
      listedValues.delete(key);
      if (writeJournal(key, value)) return true;
      await set(key, value);
      return false;
    },
    async delete(key) {
      listedValues.delete(key);
      localStorage.removeItem(journalKey(key));
      await (await durable)?.delete(key);
    },
    async keys() {
      // The journal before IndexedDB too: a transaction moving from one to the other, as the
      // leader saves it, is in at least one of them throughout
      const journaledBefore = journalKeys();
      const stored = (await (await strict)?.keys()) ?? [];
      const keys = [...new Set([...journaledBefore, ...stored, ...journalKeys()])];
      const shown = await Promise.all(keys.map(listed));
      return keys.filter((_, i) => shown[i]);
    },
    journaledKeys: () =>
      journalKeys().filter((key) => listedAs(key, localStorage.getItem(journalKey(key)))),
    async clear() {
      listedValues.clear();
      for (const key of journalKeys()) localStorage.removeItem(journalKey(key));
      await (await durable)?.clear();
    },
  };
};

/** Undefined leaves the choice to the library, which runs online-only with no storage at all. */
export const createOutboxStorage = (isVisible: (stored: StoredTransaction) => boolean) =>
  LocalStorageAdapter.probe().available ? journaledStorage(isVisible) : undefined;
