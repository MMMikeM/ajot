// Each list's last server response, in IndexedDB. A tab restores it on startup (lib/db/snapshot.ts);
// the extension backgrounds also write it with no tab open (lib/sync/prewarm.ts), so it lives
// outside lib/db, which they can't import.
const DB_NAME = "newtab-todo-snapshot";
const STORE = "queries";

/**
 * Bump when a saved row's shape changes: the upgrade drops lists saved in the old shape, which
 * would otherwise show until the server answers.
 */
const SCHEMA_VERSION = 1;

export const SNAPSHOT_KEYS = ["tasks", "categories", "notes", "contacts"] as const;

export const openSnapshotDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

export const readSnapshot = (db: IDBDatabase, keys: readonly string[]) =>
  new Promise<Map<string, unknown>>((resolve, reject) => {
    const store = db.transaction(STORE).objectStore(STORE);
    const found = new Map<string, unknown>();
    for (const key of keys) {
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result !== undefined) found.set(key, request.result);
      };
    }
    store.transaction.oncomplete = () => resolve(found);
    store.transaction.onerror = () => reject(store.transaction.error);
  });

/** An entry saved as undefined is removed. */
export const writeSnapshot = (db: IDBDatabase, entries: Iterable<readonly [string, unknown]>) =>
  new Promise<void>((resolve, reject) => {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    for (const [key, data] of entries) {
      if (data === undefined) store.delete(key);
      else store.put(data, key);
    }
    store.transaction.oncomplete = () => resolve();
    store.transaction.onerror = () => reject(store.transaction.error);
  });

/**
 * Writes and closes again: a connection left open would block a newer deploy's upgrade until
 * this one closed it.
 */
export const saveSnapshot = async (entries: Iterable<readonly [string, unknown]>) => {
  const db = await openSnapshotDb();
  try {
    await writeSnapshot(db, entries);
  } finally {
    db.close();
  }
};

/** For a reader that keeps no connection open, like the PWA's service worker. */
export const loadSnapshotEntry = async (key: string) => {
  const db = await openSnapshotDb();
  try {
    return (await readSnapshot(db, [key])).get(key);
  } finally {
    db.close();
  }
};
