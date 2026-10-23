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
export { contactsCollection };
export const useTasks = () => useLiveQuery(tasksCollection);
export const useCategories = () => useLiveQuery(categoriesCollection);
export const useNotes = () => useLiveQuery(notesCollection);
export const useContacts = () => useLiveQuery(contactsCollection);

export const updateTask = (id: string, fields: Partial<Task>) => {
  console.log(`[mutation] updateTask id=${id}`, fields);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncTasks" });
  tx.mutate(() =>
    tasksCollection.update(id, (draft) => Object.assign(draft, { ...fields, updatedAt: now() })),
  );
  console.log("[mutation] optimistic applied, tx queued");
};

/** Returns an undo that brings back the task, its subtasks and their notes' links. */
export const deleteTask = (id: string) => {
  console.log(`[mutation] deleteTask id=${id}`);
  const deleted = [...(tasksCollection.state?.values() ?? [])]
    .filter((t) => t.id === id || t.parentId === id)
    .sort((a, b) => Number(b.id === id) - Number(a.id === id));
  const deletedIds = new Set(deleted.map((t) => t.id));
  const noteLinks = [...(notesCollection.state?.values() ?? [])].flatMap((n) =>
    n.taskId && deletedIds.has(n.taskId) ? [{ id: n.id, taskId: n.taskId }] : [],
  );
  const tx = offline.createOfflineTransaction({
    mutationFnName: "deleteTask",
    metadata: { taskId: id } satisfies TaskDeleteMetadata,
  });
  tx.mutate(() => {
    tasksCollection.delete([...deletedIds]);
    for (const link of noteLinks)
      notesCollection.update(link.id, (draft) =>
        Object.assign(draft, { taskId: null, updatedAt: now() }),
      );
  });
  console.log("[mutation] optimistic applied, tx queued");
  return () => restoreTasks(deleted, noteLinks);
};

// Shares were deleted with the task and don't come back
const restoreTasks = (tasks: Task[], noteLinks: { id: string; taskId: string }[]) => {
  const tx = offline.createOfflineTransaction({ mutationFnName: "restoreTasks" });
  tx.mutate(() => {
    for (const task of tasks) tasksCollection.insert({ ...task, shares: [], updatedAt: now() });
    for (const link of noteLinks)
      notesCollection.update(link.id, (draft) =>
        Object.assign(draft, { taskId: link.taskId, updatedAt: now() }),
      );
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

export const deleteNote = (id: string) => {
  console.log(`[mutation] deleteNote id=${id}`);
  const tx = offline.createOfflineTransaction({ mutationFnName: "syncNotes" });
  tx.mutate(() => notesCollection.delete(id));
  console.log("[mutation] optimistic applied, tx queued");
};
