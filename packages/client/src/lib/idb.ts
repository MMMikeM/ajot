// Outside lib/db, so the extension backgrounds and the PWA's worker can use it too

/** Opens `name`, letting `upgrade` create its stores when `version` is newer than the one there. */
export const openDb = (name: string, version: number, upgrade: (db: IDBDatabase) => void) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = () => upgrade(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/** Resolves once the transaction commits, and rejects if it fails or is aborted. */
export const transactionDone = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    // An abort with no error of its own still has to settle, or whoever waits on it waits for good
    tx.onabort = () => reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
  });

/**
 * Opens, runs one transaction and closes: a connection left open would block a newer deploy's
 * upgrade. `run` queues the transaction's requests and returns what to read once it has committed.
 */
export const inTransaction = async <T>(
  open: () => Promise<IDBDatabase>,
  stores: string | string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction) => () => T,
) => {
  const db = await open();
  try {
    const tx = db.transaction(stores, mode);
    const result = run(tx);
    await transactionDone(tx);
    return result();
  } finally {
    db.close();
  }
};

/** The request's result, read once the transaction has committed. */
export const resultOf = <T>(request: IDBRequest) => {
  let value: T | undefined;
  request.onsuccess = () => (value = request.result as T | undefined);
  return () => value;
};
