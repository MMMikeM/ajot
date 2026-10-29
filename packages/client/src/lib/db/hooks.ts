import { useLiveQuery } from "@tanstack/react-db";
import {
  tasksCollection,
  categoriesCollection,
  notesCollection,
  contactsCollection,
  attachmentsCollection,
} from "~/lib/db/collections";
import {
  createOfflineTransaction,
  type CategoryDeleteMetadata,
  type CategoryRestoreMetadata,
  type ContactRemovalMetadata,
  type ShareFilingMetadata,
  type TaskDeleteMetadata,
} from "~/lib/db/offline";
import { getCurrentUserId } from "~/lib/auth/current-user";
import type { CategoryTaskAction } from "~/lib/constants";
import type { Attachment, Task, Category, Note } from "~/lib/types";
import type { Placement } from "~/lib/effective-category";
import { now } from "~/lib/utils";
import { MAX_TASK_IDS, MAX_TITLE, cutTo } from "@newtab-todo/shared/field-limits";
import { taskChangeStamps } from "@newtab-todo/shared/task-stamps";
export { contactsCollection };
export const useTasks = () => useLiveQuery(tasksCollection);
export const useCategories = () => useLiveQuery(categoriesCollection);
export const useNotes = () => useLiveQuery(notesCollection);
export const useContacts = () => useLiveQuery(contactsCollection);
export const useAttachmentRows = () => useLiveQuery(attachmentsCollection);

export const updateTask = (id: string, fields: Partial<Task>) => {
  console.log(`[mutation] updateTask id=${id}`, fields);
  const at = now();
  const stamps = taskChangeStamps(fields, at);
  const tx = createOfflineTransaction({ mutationFnName: "syncTasks" });
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
  const tx = createOfflineTransaction({
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

/** Deletes the task and its subtasks in one transaction, so one Undo restores them all. */
export const deleteTask = (id: string) => {
  console.log(`[mutation] deleteTask id=${id}`);
  // The parent first, so Undo re-inserts it before its subtasks
  const deleted = [...(tasksCollection.state?.values() ?? [])]
    .filter((t) => t.id === id || t.parentId === id)
    .sort((a, b) => Number(b.id === id) - Number(a.id === id));
  const tx = createOfflineTransaction({
    mutationFnName: "deleteTask",
    // Still a list: an outbox saved before Clear was removed can hold several
    metadata: { taskIds: [id] } satisfies TaskDeleteMetadata,
  });
  tx.mutate(() => tasksCollection.delete(deleted.map((t) => t.id)));
  console.log("[mutation] optimistic applied, tx queued");
  return () => restoreTasks(deleted);
};

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
// until the restore lands. Each keeps its own updatedAt: a restore isn't an edit, and the server
// keeps the later of the two, so stamping it now would turn away edits made after the delete.
const restoreTasks = (tasks: Task[]) => {
  const tx = createOfflineTransaction({ mutationFnName: "restoreTasks" });
  tx.mutate(() => {
    for (const task of tasks) tasksCollection.insert(task);
  });
};

export const addCategory = (
  fields: Omit<Category, "id" | "createdAt" | "updatedAt" | "collaborators">,
) => {
  const id = crypto.randomUUID();
  console.log(`[mutation] addCategory id=${id}`, fields);
  const tx = createOfflineTransaction({ mutationFnName: "syncCategories" });
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
  const tx = createOfflineTransaction({ mutationFnName: "syncCategories" });
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
  const tx = createOfflineTransaction({
    mutationFnName: "deleteCategory",
    metadata: {
      categoryId: id,
      tasks,
      // More than a request may name: naming none has the server take every task in the list,
      // where a refused request would bring the list back
      taskIds: topLevelIds.size <= MAX_TASK_IDS ? [...topLevelIds] : undefined,
    } satisfies CategoryDeleteMetadata,
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
  const tx = createOfflineTransaction({
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

type NewNote = Pick<Note, "userId" | "taskId"> & { content: string };

/** A note's title is the start of its text, which is all a person writes. */
export const addNote = (fields: NewNote) => {
  const id = crypto.randomUUID();
  console.log(`[mutation] addNote id=${id}`, fields);
  const tx = createOfflineTransaction({ mutationFnName: "syncNotes" });
  const title = cutTo(fields.content, MAX_TITLE);
  tx.mutate(() =>
    notesCollection.insert({ ...fields, title, id, createdAt: now(), updatedAt: now() }),
  );
  console.log("[mutation] optimistic applied, tx queued");
  return { id };
};

export const updateNote = (id: string, fields: Partial<Note>) => {
  console.log(`[mutation] updateNote id=${id}`, fields);
  const tx = createOfflineTransaction({ mutationFnName: "syncNotes" });
  tx.mutate(() =>
    notesCollection.update(id, (draft) => Object.assign(draft, { ...fields, updatedAt: now() })),
  );
  console.log("[mutation] optimistic applied, tx queued");
};

/** Returns an undo that brings the note back under its original id. */
export const deleteNote = (id: string) => {
  console.log(`[mutation] deleteNote id=${id}`);
  const deleted = notesCollection.get(id);
  const tx = createOfflineTransaction({ mutationFnName: "syncNotes" });
  tx.mutate(() => notesCollection.delete(id));
  console.log("[mutation] optimistic applied, tx queued");
  return () => {
    if (!deleted) return;
    const restore = createOfflineTransaction({ mutationFnName: "syncNotes" });
    restore.mutate(() => notesCollection.insert(noteRow(deleted)));
  };
};

/**
 * Removes the contact for both people, not only this user, and the lists they shared. Its Undo
 * queues behind it, so a dropped connection loses neither. Returns the transaction, whose
 * `isPersisted.promise` rejects if the server refuses, and an undo that resolves once the server
 * has them back.
 */
export const removeContact = (id: string) => {
  console.log(`[mutation] removeContact id=${id}`);
  const contact = contactsCollection.get(id);
  const metadata = { contactId: id } satisfies ContactRemovalMetadata;
  const tx = createOfflineTransaction({ mutationFnName: "removeContact", metadata });
  const transaction = tx.mutate(() => contactsCollection.delete(id));
  const undo = () => {
    if (!contact) return Promise.reject(new Error(`contact ${id} wasn't loaded`));
    const restore = createOfflineTransaction({
      mutationFnName: "restoreContact",
      metadata,
    });
    return restore.mutate(() => contactsCollection.insert(contact)).isPersisted.promise;
  };
  return { transaction, undo };
};

/** An uploaded attachment; one still uploading belongs to the upload queue (`lib/files/uploads.ts`). */
export const deleteAttachment = (row: Attachment) => {
  console.log(`[mutation] deleteAttachment id=${row.id}`);
  const tx = createOfflineTransaction({ mutationFnName: "deleteAttachment" });
  tx.mutate(() => attachmentsCollection.delete(row.id));
  return () => {
    const restore = createOfflineTransaction({ mutationFnName: "restoreAttachment" });
    restore.mutate(() => attachmentsCollection.insert(row));
  };
};
