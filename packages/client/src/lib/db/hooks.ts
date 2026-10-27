import { useLiveQuery } from "@tanstack/react-db";
import {
  tasksCollection,
  categoriesCollection,
  notesCollection,
  contactsCollection,
} from "~/lib/db/collections";
import {
  offline,
  type CategoryDeleteMetadata,
  type CategoryRestoreMetadata,
  type ShareFilingMetadata,
  type TaskDeleteMetadata,
} from "~/lib/db/offline";
import { getCurrentUserId } from "~/lib/auth/current-user";
import type { CategoryTaskAction } from "~/lib/constants";
import type { Task, Category, Note } from "~/lib/types";
import type { Placement } from "~/lib/effective-category";
import { now } from "~/lib/utils";
import { taskChangeStamps } from "@newtab-todo/shared/task-stamps";
export { contactsCollection };
export const useTasks = () => useLiveQuery(tasksCollection);
export const useCategories = () => useLiveQuery(categoriesCollection);
export const useNotes = () => useLiveQuery(notesCollection);
export const useContacts = () => useLiveQuery(contactsCollection);

export const updateTask = (id: string, fields: Partial<Task>) => {
  console.log(`[mutation] updateTask id=${id}`, fields);
  const at = now();
  const stamps = taskChangeStamps(fields, at);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncTasks" });
  tx.mutate(() =>
    tasksCollection.update(id, (draft) =>
      Object.assign(draft, { ...stamps, ...fields, updatedAt: at }),
    ),
  );
  console.log("[mutation] optimistic applied, tx queued");
};

// Files this user's share of a task, which is where it appears for them
const fileMyShare = (draft: Task, userId: string, categoryId: string | null) => {
  for (const share of draft.shares)
    if (share.sharedWithUserId === userId) share.categoryId = categoryId;
};

const fileShare = (taskId: string, categoryId: string | null) => {
  console.log(`[mutation] fileShare task=${taskId} list=${categoryId}`);
  const userId = getCurrentUserId();
  const tx = offline.createOfflineTransaction({
    mutationFnName: "fileShare",
    metadata: { taskId, categoryId } satisfies ShareFilingMetadata,
  });
  tx.mutate(() =>
    tasksCollection.update(taskId, (draft) => fileMyShare(draft, userId, categoryId)),
  );
};

/** Moves a task to another list the way `mode` allows; in "list" mode it isn't this user's to move. */
export const moveToList = (task: Task, mode: Placement["mode"], categoryId: string | null) => {
  if (mode === "owner") updateTask(task.id, { categoryId });
  else if (mode === "share") fileShare(task.id, categoryId);
};

/** Deletes the tasks and their subtasks in one transaction, so one Undo restores them all. */
export const deleteTasks = (ids: string[]) => {
  console.log(`[mutation] deleteTasks ids=${ids.join(",")}`);
  const roots = new Set(ids);
  // Parents first, so Undo re-inserts them before their subtasks
  const deleted = [...(tasksCollection.state?.values() ?? [])]
    .filter((t) => roots.has(t.id) || (t.parentId !== null && roots.has(t.parentId)))
    .sort((a, b) => Number(roots.has(b.id)) - Number(roots.has(a.id)));
  const deletedIds = new Set(deleted.map((t) => t.id));
  const tx = offline.createOfflineTransaction({
    mutationFnName: "deleteTask",
    metadata: { taskIds: ids } satisfies TaskDeleteMetadata,
  });
  tx.mutate(() => tasksCollection.delete([...deletedIds]));
  console.log("[mutation] optimistic applied, tx queued");
  return () => restoreTasks(deleted);
};

export const deleteTask = (id: string) => deleteTasks([id]);

// A row read from a collection also carries its virtual $ fields, which the notes API rejects
const noteRow = ({ id, userId, title, content, taskId, createdAt }: Note): Note => ({
  id,
  userId,
  title,
  content,
  taskId,
  createdAt,
  updatedAt: now(),
});

// The server kept the tasks with their shares and notes, so this only puts them back on screen
// until the restore lands
const restoreTasks = (tasks: Task[]) => {
  const tx = offline.createOfflineTransaction({ mutationFnName: "restoreTasks" });
  tx.mutate(() => {
    for (const task of tasks) tasksCollection.insert({ ...task, updatedAt: now() });
  });
};

export const addCategory = (
  fields: Omit<Category, "id" | "createdAt" | "updatedAt" | "collaborators">,
) => {
  const id = crypto.randomUUID();
  console.log(`[mutation] addCategory id=${id}`, fields);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncCategories" });
  tx.mutate(() =>
    categoriesCollection.insert({
      ...fields,
      id,
      createdAt: now(),
      updatedAt: now(),
      collaborators: [],
    }),
  );
  console.log("[mutation] optimistic applied, tx queued");
  return { id };
};

export const updateCategory = (id: string, fields: Partial<Category>) => {
  console.log(`[mutation] updateCategory id=${id}`, fields);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncCategories" });
  tx.mutate(() =>
    categoriesCollection.update(id, (draft) =>
      Object.assign(draft, { ...fields, updatedAt: now() }),
    ),
  );
  console.log("[mutation] optimistic applied, tx queued");
};

/**
 * Returns the transaction, whose `isPersisted.promise` rejects if the server refuses, and an
 * undo that puts back exactly what this changed.
 */
export const deleteCategory = (id: string, tasks: CategoryTaskAction) => {
  console.log(`[mutation] deleteCategory id=${id} tasks=${tasks}`);
  const category = categoriesCollection.get(id);
  const allTasks = [...(tasksCollection.state?.values() ?? [])];
  const topLevelIds = new Set(allTasks.filter((t) => t.categoryId === id).map((t) => t.id));
  const userId = getCurrentUserId();
  const isMine = (share: Task["shares"][number]) => share.sharedWithUserId === userId;
  // Shared with this user and filed under the category: the server unfiles it, whatever `tasks` is
  const filedByMyShare = (task: Task) => task.shares.some((s) => isMine(s) && s.categoryId === id);
  const deleted: Task[] = [];
  const movedIds: string[] = [];
  const unfiledIds: string[] = [];
  const tx = offline.createOfflineTransaction({
    mutationFnName: "deleteCategory",
    metadata: { categoryId: id, tasks, taskIds: [...topLevelIds] } satisfies CategoryDeleteMetadata,
  });
  const transaction = tx.mutate(() => {
    for (const task of allTasks) {
      const inCategory =
        topLevelIds.has(task.id) || (task.parentId && topLevelIds.has(task.parentId));
      if (tasks === "delete" && inCategory) {
        deleted.push(task);
        tasksCollection.delete(task.id);
      } else if (topLevelIds.has(task.id)) {
        movedIds.push(task.id);
        tasksCollection.update(task.id, (draft) =>
          Object.assign(draft, { categoryId: null, updatedAt: now() }),
        );
      } else if (filedByMyShare(task)) {
        unfiledIds.push(task.id);
        tasksCollection.update(task.id, (draft) => fileMyShare(draft, userId, null));
      }
    }
    categoriesCollection.delete(id);
  });
  console.log("[mutation] optimistic applied, tx queued");
  // Parents first, so they're back before their subtasks
  deleted.sort((a, b) => Number(a.parentId !== null) - Number(b.parentId !== null));
  const undo = () =>
    category
      ? restoreCategory(category, deleted, movedIds, unfiledIds)
      : Promise.reject(new Error(`category ${id} wasn't loaded`));
  return { transaction, undo };
};

// The server kept the list with its sharing and its tasks, so this only puts them back on screen
// until the restore lands. Resolves once the server has them back.
const restoreCategory = (
  category: Category,
  deleted: Task[],
  movedIds: string[],
  unfiledIds: string[],
) => {
  console.log(`[mutation] restoreCategory id=${category.id}`);
  const userId = getCurrentUserId();
  const tx = offline.createOfflineTransaction({
    mutationFnName: "restoreCategory",
    metadata: { categoryId: category.id } satisfies CategoryRestoreMetadata,
  });
  const at = now();
  const transaction = tx.mutate(() => {
    categoriesCollection.insert({ ...category, updatedAt: at });
    for (const task of deleted) tasksCollection.insert({ ...task, updatedAt: at });
    for (const id of movedIds)
      if (tasksCollection.has(id))
        tasksCollection.update(id, (draft) =>
          Object.assign(draft, { categoryId: category.id, updatedAt: at }),
        );
    for (const id of unfiledIds)
      if (tasksCollection.has(id))
        tasksCollection.update(id, (draft) => fileMyShare(draft, userId, category.id));
  });
  return transaction.isPersisted.promise;
};

export const addNote = (fields: Omit<Note, "id" | "createdAt" | "updatedAt">) => {
  const id = crypto.randomUUID();
  console.log(`[mutation] addNote id=${id}`, fields);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncNotes" });
  tx.mutate(() => notesCollection.insert({ ...fields, id, createdAt: now(), updatedAt: now() }));
  console.log("[mutation] optimistic applied, tx queued");
  return { id };
};

export const updateNote = (id: string, fields: Partial<Note>) => {
  console.log(`[mutation] updateNote id=${id}`, fields);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncNotes" });
  tx.mutate(() =>
    notesCollection.update(id, (draft) => Object.assign(draft, { ...fields, updatedAt: now() })),
  );
  console.log("[mutation] optimistic applied, tx queued");
};

/** Returns an undo that brings the note back under its original id. */
export const deleteNote = (id: string) => {
  console.log(`[mutation] deleteNote id=${id}`);
  const deleted = notesCollection.get(id);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncNotes" });
  tx.mutate(() => notesCollection.delete(id));
  console.log("[mutation] optimistic applied, tx queued");
  return () => {
    if (!deleted) return;
    const restore = offline.createOfflineTransaction({ mutationFnName: "syncNotes" });
    restore.mutate(() => notesCollection.insert(noteRow(deleted)));
  };
};
