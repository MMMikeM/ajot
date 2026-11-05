import { openDb, transactionDone } from "~/lib/idb";
// The extension backgrounds write it with no tab open (lib/sync/prewarm.ts), so it lives outside
// lib/db, which they can't import.
const DB_NAME = "newtab-todo-snapshot";
const STORE = "queries";

/**
 * Bump when a saved row's shape changes: the upgrade drops lists saved in the old shape, which
 * would otherwise show until the server answers.
 */
const SCHEMA_VERSION = 1;

export const SNAPSHOT_KEYS = ["tasks", "categories", "notes", "contacts", "attachments"] as const;

/**
 * The account the lists were saved for, written with them: a page signed into another one, or
 * signed out, doesn't open on them. Lists saved before it existed have none.
 */
export const OWNER_KEY = "owner";

export const openSnapshotDb = () =>
  openDb(DB_NAME, SCHEMA_VERSION, (db) => {
    if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
    db.createObjectStore(STORE);
  });

export const readSnapshot = async (db: IDBDatabase, keys: readonly string[]) => {
  const tx = db.transaction(STORE);
  const store = tx.objectStore(STORE);
  const found = new Map<string, unknown>();
  for (const key of keys) {
    const request = store.get(key);
    request.onsuccess = () => {
      if (request.result !== undefined) found.set(key, request.result);
    };
  }
  await transactionDone(tx);
  return found;
};

export const writeSnapshot = (db: IDBDatabase, entries: Iterable<readonly [string, unknown]>) => {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  for (const [key, data] of entries) {
    if (data === undefined) store.delete(key);
    else store.put(data, key);
  }
  return transactionDone(tx);
};

/**
 * The other lists, if they were saved for another account, go with it: a page opened as this one
 * would otherwise show them as its own.
 */
export const writeListFor = (
  db: IDBDatabase,
  key: string,
  data: unknown,
  owner: string | undefined,
) => {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const saved = store.get(OWNER_KEY);
  saved.onsuccess = () => {
    if (saved.result !== owner)
      for (const other of SNAPSHOT_KEYS) if (other !== key) store.delete(other);
    if (data === undefined) store.delete(key);
    else store.put(data, key);
    if (owner === undefined) store.delete(OWNER_KEY);
    else store.put(owner, OWNER_KEY);
  };
  return transactionDone(tx);
};

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

/** Leaves the worker's session, kept in the same store, alone. */
export const clearSavedLists = () =>
  saveSnapshot([...SNAPSHOT_KEYS, OWNER_KEY].map((key) => [key, undefined] as const));

export const loadSnapshotEntry = async (key: string) => {
  const db = await openSnapshotDb();
  try {
    return (await readSnapshot(db, [key])).get(key);
  } finally {
    db.close();
  }
};
