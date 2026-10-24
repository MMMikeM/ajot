import type { QueryClient } from "@tanstack/react-query";

// Keeps each list's last server response in IndexedDB and puts it back in the query cache on
// startup, so a query collection fills from it before the server answers. Collections without
// SQLite persistence apply cached data straight away.
const DB_NAME = "newtab-todo-snapshot";
const STORE = "queries";
const SAVE_DELAY_MS = 200;

const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const read = (db: IDBDatabase, keys: readonly string[]) =>
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

/** Seeds the cache from the saved lists, then saves each list again whenever its query changes. */
export const restoreSnapshot = async (queryClient: QueryClient, keys: readonly string[]) => {
  const db = await openDb();
  for (const [key, data] of await read(db, keys)) queryClient.setQueryData([key], data);

  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    const [key, ...rest] = event.query.queryKey;
    if (rest.length > 0 || typeof key !== "string" || !keys.includes(key)) return;
    // Live sync can update a list several times in a row; save the last of them
    clearTimeout(pending.get(key));
    pending.set(
      key,
      setTimeout(() => {
        pending.delete(key);
        db.transaction(STORE, "readwrite").objectStore(STORE).put(event.query.state.data, key);
      }, SAVE_DELAY_MS),
    );
  });
};
