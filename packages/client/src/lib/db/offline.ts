import {
  startOfflineExecutor,
  NonRetriableError,
  type CreateOfflineTransactionOptions,
} from "@tanstack/offline-transactions";
import { DeleteOperationItemNotFoundError } from "@tanstack/query-db-collection";
import {
  tasksCollection,
  categoriesCollection,
  notesCollection,
  contactsCollection,
} from "~/lib/db/collections";
import { client } from "~/lib/api";
import { getAuthToken, subscribeAuthToken } from "~/lib/auth/token";
import { getCurrentUserId, getSignedInUserId } from "~/lib/auth/current-user";
import { createOutboxStorage } from "~/lib/db/outbox-storage";
import type { CategoryTaskAction } from "~/lib/constants";
import type { ISODateString } from "@newtab-todo/shared/iso";
import type { Collection } from "@tanstack/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- transaction mutation payloads are untyped
type AnyJson = any;

interface ResourceEndpoint {
  $post: (opts: { json: AnyJson }) => Promise<Response>;
  $put: (opts: { json: AnyJson }) => Promise<Response>;
  $delete: (opts: { json: AnyJson }) => Promise<Response>;
}

class SessionExpiredError extends Error {}

class HeldForAccountError extends Error {}

const assertOk = async (res: Response): Promise<Response> => {
  if (res.ok) return res;
  // Keep the edit queued: it replays once the user signs in again.
  if (res.status === 401) throw new SessionExpiredError(await res.text());
  if (res.status >= 400 && res.status < 500) throw new NonRetriableError(await res.text());
  throw new Error(`Server error ${res.status}`);
};

// A replay after a lost response finds the row already gone, which means the delete worked
const assertDeleted = (res: Response) => (res.status === 404 ? res : assertOk(res));

// This device's own SSE event can remove the row from the synced store before the response lands
const writeDeleted = async (
  collection: Collection<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
  key: string,
) => {
  try {
    await collection.utils.writeDelete(key as never);
  } catch (err) {
    if (!(err instanceof DeleteOperationItemNotFoundError)) throw err;
  }
};

type PendingWrite = {
  type: string;
  modified: Record<string, unknown>;
  changes: Record<string, unknown>;
  key: string;
  collection: unknown;
};

const syncMutation =
  (
    name: string,
    endpoint: ResourceEndpoint,
    collection: Collection<any, any, any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    stripKeys: string[] = [],
  ) =>
  async (m: PendingWrite) => {
    console.log(`[sync:${name}] ${m.type} key=${m.key}`);

    if (m.type === "insert") {
      const payload = { ...m.modified };
      for (const k of stripKeys) delete payload[k];
      // Tasks/categories/notes created offline carry a local device userId.
      // Always stamp with the current authenticated userId so the server FK passes.
      if ("userId" in payload) payload.userId = getCurrentUserId();
      console.log(`[sync:${name}] POST →`, payload);
      const res = await assertOk(await endpoint.$post({ json: payload }));
      const created = await res.json();
      console.log(`[sync:${name}] POST ← 200, writing to synced store`);
      await collection.utils.writeUpsert(created as never);
    } else if (m.type === "update") {
      const payload = { ...m.changes, id: m.key };
      console.log(`[sync:${name}] PUT →`, payload);
      const res = await assertOk(await endpoint.$put({ json: payload }));
      const updated = await res.json();
      console.log(`[sync:${name}] PUT ← 200, writing to synced store`);
      await collection.utils.writeUpdate(updated as never);
    } else if (m.type === "delete") {
      console.log(`[sync:${name}] DELETE → id=${m.key}`);
      await assertDeleted(await endpoint.$delete({ json: { id: m.key } }));
      console.log(`[sync:${name}] DELETE ← 200, removing from synced store`);
      await writeDeleted(collection, m.key);
    }

    console.log(
      `[sync:${name}] ${m.type} complete — synced store updated before optimistic removal`,
    );
  };

/** Who queued an edit, null when signed out: anyone who signs in next may send it. */
type AccountMetadata = { accountId?: string | null };

/** Every edit goes through here, so it's sent only by the account that made it. */
export const createOfflineTransaction = (options: CreateOfflineTransactionOptions) =>
  offline.createOfflineTransaction({
    ...options,
    metadata: { ...options.metadata, accountId: getSignedInUserId() } satisfies AccountMetadata,
  });

const accountOf = (metadata: unknown) => (metadata as AccountMetadata | undefined)?.accountId;

// No auth token — defer sync until login. A retriable error (not NonRetriableError)
// keeps the transaction in the IDB outbox and holds the optimistic mutation visible. One queued
// by another account waits the same way, for that account.
const assertSignedIn = (metadata: unknown) => {
  if (!getAuthToken()) throw new Error("Not authenticated");
  const account = accountOf(metadata);
  if (account && account !== getSignedInUserId())
    throw new HeldForAccountError(`Queued by account ${account}`);
};

const syncEach =
  (sync: (m: PendingWrite) => Promise<void>) =>
  async ({ transaction }: { transaction: { metadata: unknown; mutations: PendingWrite[] } }) => {
    assertSignedIn(transaction.metadata);
    for (const m of transaction.mutations) await sync(m);
  };

const syncTask = syncMutation("tasks", client.api.tasks, tasksCollection);
const syncCategory = syncMutation("categories", client.api.categories, categoriesCollection, [
  "user",
  "collaborators",
]);
const syncNote = syncMutation("notes", client.api.notes, notesCollection);

export type TaskDeleteMetadata = { taskIds: string[] };
// What a single delete queued before batches; an outbox can still hold one after an update
type LegacyTaskDeleteMetadata = { taskId: string };

// One request for the task: the server deletes its subtasks with it, so a DELETE per subtask
// would 404
const deleteTaskWithSubtasks = async ({
  transaction,
}: {
  transaction: { metadata: Record<string, unknown>; mutations: PendingWrite[] };
}) => {
  assertSignedIn(transaction.metadata);
  const metadata = transaction.metadata as TaskDeleteMetadata | LegacyTaskDeleteMetadata;
  const taskIds = "taskIds" in metadata ? metadata.taskIds : [metadata.taskId];
  for (const taskId of taskIds) {
    console.log(`[sync:tasks] DELETE → id=${taskId} with subtasks`);
    await assertDeleted(await client.api.tasks.$delete({ json: { id: taskId } }));
  }
  for (const m of transaction.mutations)
    // A delete queued before deletes kept notes also unlinked them here; the server no longer does
    if (m.collection === notesCollection) await notesCollection.utils.refetch();
    else await writeDeleted(tasksCollection, m.key);
};

// A delete only hid the task on the server, so Undo clears that rather than adding it again
const restoreTask = async (m: PendingWrite) => {
  console.log(`[sync:tasks] restore key=${m.key}`);
  const res = await assertOk(
    await client.api.tasks.$put({
      json: { id: m.key, deletedAt: null, updatedAt: m.modified.updatedAt as ISODateString },
    }),
  );
  await tasksCollection.utils.writeUpsert({ ...m.modified, ...(await res.json()) } as never);
};

// Parents before their subtasks, which the server restores one by one. A restore queued before
// deletes kept notes also relinks notes.
const restoreTasksAndNotes = async ({
  transaction,
}: {
  transaction: { metadata: unknown; mutations: PendingWrite[] };
}) => {
  assertSignedIn(transaction.metadata);
  for (const m of transaction.mutations)
    await (m.collection === notesCollection ? syncNote(m) : restoreTask(m));
};

export type ShareFilingMetadata = { taskId: string; categoryId: string | null };

// Filing changes the recipient's share, not the task, so it has an endpoint of its own
const fileShare = async ({
  transaction,
}: {
  transaction: { metadata: Record<string, unknown>; mutations: PendingWrite[] };
}) => {
  assertSignedIn(transaction.metadata);
  const { taskId, categoryId } = transaction.metadata as ShareFilingMetadata;
  console.log(`[sync:tasks] file share → task=${taskId} list=${categoryId}`);
  await assertOk(await client.api.tasks.share.$put({ json: { taskId, categoryId } }));
  const [filed] = transaction.mutations;
  // Gone meanwhile, deleted by its owner: there's no row left to file
  if (filed && tasksCollection.has(taskId))
    await tasksCollection.utils.writeUpdate({ id: taskId, shares: filed.modified.shares } as never);
};

export type CategoryDeleteMetadata = {
  categoryId: string;
  tasks: CategoryTaskAction;
  taskIds: string[];
};

// One request for the category and its tasks: the server moves or deletes collaborators'
// tasks too, which this user can't change one by one
const deleteCategoryWithTasks = async ({
  transaction,
}: {
  transaction: { metadata: Record<string, unknown> };
}) => {
  assertSignedIn(transaction.metadata);
  const { categoryId, tasks, taskIds } = transaction.metadata as CategoryDeleteMetadata;
  console.log(`[sync:categories] DELETE → id=${categoryId} tasks=${tasks}`);
  await assertDeleted(
    await client.api.categories.$delete({ json: { id: categoryId, tasks, taskIds } }),
  );
  // Refetch rather than write each row: SSE may already have applied some, and writing a
  // delete for a row the synced store no longer holds throws
  await Promise.all([
    categoriesCollection.utils.refetch(),
    tasksCollection.utils.refetch(),
    notesCollection.utils.refetch(),
  ]);
};

export type CategoryRestoreMetadata = { categoryId: string };

// One request: the server kept the list, its sharing and its tasks, collaborators' tasks too
const restoreCategoryWithTasks = async ({
  transaction,
}: {
  transaction: { metadata: Record<string, unknown> };
}) => {
  assertSignedIn(transaction.metadata);
  const { categoryId } = transaction.metadata as CategoryRestoreMetadata;
  console.log(`[sync:categories] restore → id=${categoryId}`);
  await assertOk(await client.api.categories[":id"].restore.$post({ param: { id: categoryId } }));
  await Promise.all([
    categoriesCollection.utils.refetch(),
    tasksCollection.utils.refetch(),
    notesCollection.utils.refetch(),
  ]);
};

export const offline = startOfflineExecutor({
  storage: createOutboxStorage((value) => {
    const account = accountOf(value.metadata);
    return !account || account === getSignedInUserId();
  }),
  collections: { tasks: tasksCollection, categories: categoriesCollection, notes: notesCollection },
  mutationFns: {
    syncTasks: syncEach(syncTask),
    syncCategories: syncEach(syncCategory),
    syncNotes: syncEach(syncNote),
    deleteTask: deleteTaskWithSubtasks,
    restoreTasks: restoreTasksAndNotes,
    fileShare,
    deleteCategory: deleteCategoryWithTasks,
    restoreCategory: restoreCategoryWithTasks,
  },
  // The default policy drops any error whose message contains "401" or "403", so decide by type.
  shouldRetry: (error) =>
    error instanceof SessionExpiredError || error instanceof HeldForAccountError ? true : undefined,
});

// Kick off storage probe + leader election + outbox replay as early as possible.
offline.waitForInit().catch(console.error);

// Signed out, the refetches empty the lists, and drop an answer still on its way for the account
subscribeAuthToken(() => {
  // Replays queued edits now instead of after their retry backoff, ahead of the refetches.
  if (getAuthToken()) offline.getOnlineDetector().notifyOnline();
  tasksCollection.utils.refetch().catch(console.error);
  categoriesCollection.utils.refetch().catch(console.error);
  notesCollection.utils.refetch().catch(console.error);
  contactsCollection.utils.refetch().catch(console.error);
});
