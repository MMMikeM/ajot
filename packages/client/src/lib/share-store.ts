import type { SharedText } from "@newtab-todo/shared/share-target";

// Apart from the lists' snapshot, whose upgrade drops everything in it: a share is the user's
// only copy until its task and files are added
const DB_NAME = "ajot-shares";
const STORE = "shares";

/** Where the extension's menu sends a share. Without one, it's an open page's to add and show. */
export type ShareDestination =
  | { kind: "inbox" }
  | { kind: "list"; categoryId: string }
  | { kind: "share"; username: string }
  | { kind: "send"; recipientId: string };

/** A share as kept: its text, and what the menu adds with it, for the account that made it. */
export type KeptShare = SharedText & {
  to?: ShareDestination;
  note?: { id: string; content: string };
  userId?: string;
};

// A share's text under its id, and each of its files under [id, index] beside it, so its task
// and its progress are written without copying a file again
// `added` once its task is in: a retry after that carries on from what follows, so it can't bring
// back a task deleted meanwhile, which adding it again would restore
type KeptText = KeptShare & { taskId?: string; added?: true };
type FileKey = [string, number];

/** Held by whoever adds a share, a page or the extension's background, so it's added once. */
export const shareLockName = (id: string) => `ajot-share-${id}`;

const filesOf = (id: string) => IDBKeyRange.bound([id, 0], [id, Infinity]);

const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

// Opens, runs one transaction and closes, as lib/files/store.ts does: a connection left open
// would block a newer deploy's upgrade
const inStore = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => () => T) => {
  const db = await open();
  try {
    const tx = db.transaction(STORE, mode);
    const result = run(tx.objectStore(STORE));
    await done(tx);
    return result();
  } finally {
    db.close();
  }
};

const write = (run: (store: IDBObjectStore) => void) =>
  inStore("readwrite", (store) => {
    run(store);
    return () => undefined;
  });

export const keepShare = (id: string, text: KeptShare, files: File[]) =>
  write((store) => {
    store.put(text, id);
    files.forEach((file, index) => store.put(file, [id, index] satisfies FileKey));
  });

/** The share's text and the files not yet queued from it, oldest first. */
export const readShare = (id: string) =>
  inStore("readonly", (store) => {
    const text = store.get(id);
    const keys = store.getAllKeys(filesOf(id));
    const files = store.getAll(filesOf(id));
    return () => {
      if (!text.result) return undefined;
      const fileKeys = keys.result as FileKey[];
      return {
        text: text.result as KeptText,
        files: (files.result as File[]).map((file, index) => ({ file, key: fileKeys[index]! })),
      };
    };
  });

/** Gives the share the task it goes to, so a page closed partway through finishes on that one. */
export const setShareTask = (id: string, text: KeptShare, taskId: string) =>
  write((store) => store.put({ ...text, taskId } satisfies KeptText, id));

/** Marks the share's task as added, so nothing adds it again. */
export const setShareAdded = (id: string, text: KeptShare, taskId: string) =>
  write((store) => store.put({ ...text, taskId, added: true } satisfies KeptText, id));

export const forgetSharedFile = (key: FileKey) => write((store) => store.delete(key));

export const forgetShare = (id: string) =>
  write((store) => {
    store.delete(id);
    store.delete(filesOf(id));
  });

/** Every share still waiting, by id. */
export const keptShareIds = () =>
  inStore("readonly", (store) => {
    const keys = store.getAllKeys();
    return () => keys.result.filter((key): key is string => typeof key === "string");
  });

const KEPT_CHANNEL = "ajot-shares";

/** Tells open pages a share is waiting for them to add. */
export const announceKeptShare = () => {
  const channel = new BroadcastChannel(KEPT_CHANNEL);
  channel.postMessage("kept");
  channel.close();
};

export const onKeptShare = (listener: () => void) => {
  const channel = new BroadcastChannel(KEPT_CHANNEL);
  channel.onmessage = listener;
  return () => channel.close();
};
