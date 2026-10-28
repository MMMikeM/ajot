import type { Collection } from "@tanstack/db";
import {
  DeleteOperationItemNotFoundError,
  UpdateOperationItemNotFoundError,
} from "@tanstack/query-db-collection";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows of any collection
type AnyCollection = Collection<any, any, any>;

// This device's own SSE event can remove the row from the synced store before the response lands
export const writeDeleted = async (collection: AnyCollection, key: string | number) => {
  try {
    await collection.utils.writeDelete(key as never);
  } catch (err) {
    if (!(err instanceof DeleteOperationItemNotFoundError)) throw err;
  }
};

/**
 * Writes an edit the server accepted to the synced store as it was made, so the row doesn't flick
 * back to its old value once the edit settles, before the server's own copy arrives. A row gone
 * meanwhile stays gone.
 */
export const writeAccepted = async (edit: {
  type: string;
  key: string | number;
  modified: object;
  collection: unknown;
}) => {
  const collection = edit.collection as AnyCollection;
  const { type, key, modified } = edit;
  if (type === "delete") return writeDeleted(collection, key);
  const { utils } = collection;
  try {
    await (type === "update" ? utils.writeUpdate(modified) : utils.writeUpsert(modified));
  } catch (err) {
    if (!(err instanceof UpdateOperationItemNotFoundError)) throw err;
  }
};

/**
 * Refetches without waiting. A mutation function must never await a refetch: once the device
 * reconnects or the page is shown with edits queued, the executor holds every collection's fetched
 * rows until its queue drains (`deferDataRefresh`), and the queue waits on that mutation function,
 * so neither settled and every later edit stayed queued until a reload.
 */
export const refetchLater = (...collections: AnyCollection[]) => {
  for (const collection of collections) collection.utils.refetch().catch(console.error);
};
