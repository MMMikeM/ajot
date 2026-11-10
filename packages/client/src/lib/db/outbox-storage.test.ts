import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createOutboxStorage } from "~/lib/db/outbox-storage";

/** localStorage as `Object.keys` sees it: only the stored keys are its own enumerable ones. */
const memoryStorage = () => {
  const items: Record<string, string> = {};
  return Object.defineProperties(items, {
    getItem: { value: (key: string) => (Object.hasOwn(items, key) ? items[key] : null) },
    setItem: {
      value: (key: string, value: string) => {
        items[key] = String(value);
      },
    },
    removeItem: {
      value: (key: string) => {
        delete items[key];
      },
    },
  });
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const EDIT = JSON.stringify({ metadata: {} });

/**
 * What Safari does once it has lost its connection to IndexedDB, after `succeeding` more reads. The
 * adapter's reads catch this one, unlike a request's own error.
 */
const failReads = (succeeding = 0) => {
  const transaction = Object.getOwnPropertyDescriptor(IDBDatabase.prototype, "transaction")!
    .value as (
    this: IDBDatabase,
    ...args: Parameters<IDBDatabase["transaction"]>
  ) => IDBTransaction;
  let left = succeeding;
  return vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
    this: IDBDatabase,
    ...args
  ) {
    if (left-- > 0) return transaction.apply(this, args);
    throw new DOMException("Connection to Indexed Database server lost", "UnknownError");
  });
};

const savedEdit = async () => {
  const storage = createOutboxStorage(() => true)!;
  await storage.set("tx:1", EDIT);
  expect(localStorage.getItem("outbox-journal:tx:1")).toBeNull();
  return storage;
};

test("an edit saved to IndexedDB is listed", async () => {
  const storage = await savedEdit();
  expect(await storage.keys()).toEqual(["tx:1"]);
  expect(await storage.get("tx:1")).toBe(EDIT);
});

// Listed as empty, every tab would take its unsent edits for sent and settle them
test("a listing IndexedDB can't answer rejects instead of reading as an empty outbox", async () => {
  const storage = await savedEdit();
  failReads();
  await expect(storage.keys()).rejects.toThrow("Connection to Indexed Database server lost");
});

test("an edit IndexedDB can't read rejects the listing instead of being left off it", async () => {
  const storage = await savedEdit();
  failReads(1);
  await expect(storage.keys()).rejects.toThrow("Connection to Indexed Database server lost");
});

test("a read that failed doesn't keep the next one from answering", async () => {
  const storage = await savedEdit();
  const failing = failReads();
  await expect(storage.keys()).rejects.toThrow();
  failing.mockRestore();
  expect(await storage.keys()).toEqual(["tx:1"]);
});

test("while IndexedDB can't be read, the journal still lists the edits it holds", async () => {
  const storage = await savedEdit();
  failReads();
  await storage.keep("tx:2", EDIT);
  await expect(storage.keys()).rejects.toThrow();
  expect(storage.journaledKeys()).toEqual(["tx:2"]);
  expect(await storage.get("tx:2")).toBe(EDIT);
});
