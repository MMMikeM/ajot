import { useLiveQuery } from "@tanstack/react-db";
import {
  tasksCollection,
  categoriesCollection,
  notesCollection,
  contactsCollection,
} from "~/lib/db/collections";
import { offline, type CategoryDeleteMetadata, type TaskDeleteMetadata } from "~/lib/db/offline";
import { getCurrentUserId } from "~/lib/auth/current-user";
import type { CategoryTaskAction } from "~/lib/constants";
import type { Task, Category, Note } from "~/lib/types";
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

/** Returns the transaction, whose `isPersisted.promise` rejects if the server refuses. */
export const deleteCategory = (id: string, tasks: CategoryTaskAction) => {
  console.log(`[mutation] deleteCategory id=${id} tasks=${tasks}`);
  const allTasks = [...(tasksCollection.state?.values() ?? [])];
  const topLevelIds = new Set(allTasks.filter((t) => t.categoryId === id).map((t) => t.id));
  const userId = getCurrentUserId();
  const isMine = (share: Task["shares"][number]) => share.sharedWithUserId === userId;
  // Shared with this user and filed under the category: the server unfiles it, whatever `tasks` is
  const filedByMyShare = (task: Task) => task.shares.some((s) => isMine(s) && s.categoryId === id);
  const tx = offline.createOfflineTransaction({
    mutationFnName: "deleteCategory",
    metadata: { categoryId: id, tasks, taskIds: [...topLevelIds] } satisfies CategoryDeleteMetadata,
  });
  const transaction = tx.mutate(() => {
    for (const task of allTasks) {
      const inCategory =
        topLevelIds.has(task.id) || (task.parentId && topLevelIds.has(task.parentId));
      if (tasks === "delete" && inCategory) {
        tasksCollection.delete(task.id);
      } else if (topLevelIds.has(task.id)) {
        tasksCollection.update(task.id, (draft) =>
          Object.assign(draft, { categoryId: null, updatedAt: now() }),
        );
      } else if (filedByMyShare(task)) {
        tasksCollection.update(task.id, (draft) => {
          for (const share of draft.shares) if (isMine(share)) share.categoryId = null;
        });
      }
    }
    categoriesCollection.delete(id);
  });
  console.log("[mutation] optimistic applied, tx queued");
  return transaction;
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
