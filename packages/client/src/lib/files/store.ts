import type { ISODateString } from "@newtab-todo/shared/iso";

// Outside lib/db, which the extension backgrounds and the PWA's worker can't import, so they can
// send uploads too. A database of its own, because the snapshot's drops its lists on a version bump.
const DB_NAME = "ajot-files";
const VERSION = 1;
const BLOBS = "blobs";
const UPLOADS = "uploads";

export type Variant = "file" | "thumb";

export type SavedBlob = {
  blob: Blob;
  userId: string;
  /** An upload not yet confirmed holds its bytes: they may exist nowhere else. */
  pinned: boolean;
  savedAt: number;
  /** When it was last shown, for which full files go first over the budget. */
  usedAt?: number;
  /** When a list from the server last held its attachment. */
  seenAt?: number;
};

/** A saved blob without its bytes, for deciding what to keep. */
export type BlobMeta = Omit<SavedBlob, "blob"> & {
  key: string;
  id: string;
  variant: Variant;
  size: number;
};

/** The row as `POST /api/attachments` takes it. */
export type NewAttachment = {
  id: string;
  taskId: string;
  name: string;
  mimeType: string;
  size: number;
  thumbhash: null;
  hasThumb: boolean;
  createdAt: ISODateString;
  updatedAt: ISODateString;
};

export type Upload = {
  row: NewAttachment;
  uploaderId: string;
  /** The server has its row. */
  posted: boolean;
  /** The server has its row deleted, so Undo restores it there before sending anything else. */
  serverDeleted: boolean;
  /** Removed on this device; the entry and its bytes go once Undo can no longer bring it back. */
  deletedAt?: number;
  /** Why the server refused it. Nothing more is sent until the user retries. */
  failed?: string;
  attempts: number;
  retryAt: number;
  sizeMismatches: number;
  /** Since when `POST /` has found no task: its create may still be in a closed tab's outbox. */
  taskMissingSince?: number;
};

export const blobKey = (id: string, variant: Variant) => `${id}:${variant}`;

const listeners = new Set<() => void>();
// Opened on first use: one open at import would keep the prerender's Node process alive
let channel: BroadcastChannel | undefined;
const openChannel = () => {
  if (!channel) {
    channel = new BroadcastChannel(DB_NAME);
    channel.onmessage = () => listeners.forEach((fn) => fn());
  }
  return channel;
};

const announce = () => {
  openChannel().postMessage("uploads");
  listeners.forEach((fn) => fn());
};

/** Runs whenever an upload changes, in any context, this one included. */
export const subscribeUploads = (listener: () => void) => {
  openChannel();
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

const openFilesDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(BLOBS);
      request.result.createObjectStore(UPLOADS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

// Opens, runs one transaction and closes, as the snapshot store does: a connection left open
// would block a newer deploy's upgrade
const inTransaction = async <T>(mode: IDBTransactionMode, run: (tx: IDBTransaction) => () => T) => {
  const db = await openFilesDb();
  try {
    const tx = db.transaction([BLOBS, UPLOADS], mode);
    const result = run(tx);
    await done(tx);
    return result();
  } finally {
    db.close();
  }
};

const write = (run: (tx: IDBTransaction) => void) =>
  inTransaction("readwrite", (tx) => {
    run(tx);
    return () => undefined;
  });

const read = <T>(request: IDBRequest) => {
  let value: T | undefined;
  request.onsuccess = () => (value = request.result as T | undefined);
  return () => value;
};

/** The entry and its bytes in one transaction, so neither exists without the other. */
export const addUpload = async (upload: Upload, blobs: Partial<Record<Variant, Blob>>) => {
  await write((tx) => {
    const savedAt = Date.now();
    for (const [variant, blob] of Object.entries(blobs))
      tx.objectStore(BLOBS).put(
        { blob, userId: upload.uploaderId, pinned: true, savedAt } satisfies SavedBlob,
        blobKey(upload.row.id, variant as Variant),
      );
    tx.objectStore(UPLOADS).put(upload, upload.row.id);
  });
  announce();
};

/**
 * Makes every upload still waiting on its backoff due now: the wait was for a network that has
 * just come back, or for a page that has just opened.
 */
export const retryWaitingNow = async () => {
  let changed = false;
  await write((tx) => {
    const request = tx.objectStore(UPLOADS).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const upload = cursor.value as Upload;
      if (upload.failed === undefined && upload.retryAt > 0) {
        cursor.update({ ...upload, retryAt: 0 });
        changed = true;
      }
      cursor.continue();
    };
  });
  if (changed) announce();
};

export const readUploads = () =>
  inTransaction("readonly", (tx) => read<Upload[]>(tx.objectStore(UPLOADS).getAll())).then(
    (uploads) => uploads ?? [],
  );

/**
 * Reads the entry and writes what `change` makes of it in one transaction, so a change made
 * elsewhere meanwhile is never written over. `"uploaded"` drops the entry and leaves its bytes as
 * a cache; `"discarded"` drops both. Undefined leaves it as it is.
 */
export const changeUpload = async (
  id: string,
  change: (upload: Upload) => Upload | "uploaded" | "discarded" | undefined,
) => {
  let changed = false;
  await write((tx) => {
    const uploads = tx.objectStore(UPLOADS);
    const blobs = tx.objectStore(BLOBS);
    const request = uploads.get(id);
    request.onsuccess = () => {
      const upload = request.result as Upload | undefined;
      if (!upload) return;
      const next = change(upload);
      if (next === undefined) return;
      changed = true;
      if (typeof next === "object") {
        uploads.put(next, id);
        return;
      }
      uploads.delete(id);
      for (const variant of ["file", "thumb"] as const) {
        const key = blobKey(id, variant);
        if (next === "discarded") {
          blobs.delete(key);
          continue;
        }
        const saved = blobs.get(key);
        // Stamped afresh: bytes saved after a list was fetched must outlive any eviction that
        // works from that list
        saved.onsuccess = () => {
          const blob = saved.result as SavedBlob | undefined;
          if (blob) blobs.put({ ...blob, pinned: false, savedAt: Date.now() }, key);
        };
      }
    };
  });
  if (changed) announce();
};

export const readBlob = (id: string, variant: Variant) =>
  inTransaction("readonly", (tx) =>
    read<SavedBlob>(tx.objectStore(BLOBS).get(blobKey(id, variant))),
  );

/** Both of an attachment's blobs, in one transaction. */
export const readBlobs = (id: string) =>
  inTransaction("readonly", (tx) => {
    const blobs = tx.objectStore(BLOBS);
    const file = read<SavedBlob>(blobs.get(blobKey(id, "file")));
    const thumb = read<SavedBlob>(blobs.get(blobKey(id, "thumb")));
    return () => ({ file: file(), thumb: thumb() });
  });

/** A cache write: it changes no upload, so nothing is announced. */
export const saveBlob = (id: string, variant: Variant, blob: Blob, userId: string) =>
  write((tx) => {
    tx.objectStore(BLOBS).put(
      { blob, userId, pinned: false, savedAt: Date.now() } satisfies SavedBlob,
      blobKey(id, variant),
    );
  });

// Every key in the blobs store is a string, from blobKey
const keyOf = (cursor: IDBCursor) => (typeof cursor.key === "string" ? cursor.key : "");

/** Every saved blob's metadata; the bytes stay on disk. */
export const readBlobMetas = () =>
  inTransaction("readonly", (tx) => {
    const metas: BlobMeta[] = [];
    const request = tx.objectStore(BLOBS).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const key = keyOf(cursor);
      const { blob, ...meta } = cursor.value as SavedBlob;
      const [id = "", variant] = key.split(":");
      metas.push({ ...meta, key, id, variant: variant as Variant, size: blob.size });
      cursor.continue();
    };
    return () => metas;
  });

/** Changes or deletes each saved blob as `change` says, in one transaction. */
const updateBlobs = (change: (key: string, saved: SavedBlob) => SavedBlob | "delete" | undefined) =>
  write((tx) => {
    const request = tx.objectStore(BLOBS).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const next = change(keyOf(cursor), cursor.value as SavedBlob);
      if (next === "delete") cursor.delete();
      else if (next) cursor.update(next);
      cursor.continue();
    };
  });

/** Stamps the blobs of attachments a list from the server just held. */
export const markSeen = (ids: ReadonlySet<string>, at: number) =>
  updateBlobs((key, saved) => (ids.has(key.split(":")[0]!) ? { ...saved, seenAt: at } : undefined));

export const markUsed = (id: string, variant: Variant, at: number) =>
  write((tx) => {
    const blobs = tx.objectStore(BLOBS);
    const key = blobKey(id, variant);
    const request = blobs.get(key);
    request.onsuccess = () => {
      const saved = request.result as SavedBlob | undefined;
      if (saved) blobs.put({ ...saved, usedAt: at }, key);
    };
  });

export const deleteBlobs = (keys: ReadonlySet<string>) =>
  updateBlobs((key) => (keys.has(key) ? "delete" : undefined));

/** At sign-out: the account's saved files go, but not uploads still waiting to be sent. */
export const forgetSavedFiles = (userId: string) =>
  updateBlobs((_key, saved) => (saved.userId === userId && !saved.pinned ? "delete" : undefined));
