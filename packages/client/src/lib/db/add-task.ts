import { nanoid } from "nanoid";
import { keyAfter } from "@newtab-todo/shared/sort-order";
import { getCurrentUserId } from "~/lib/auth/current-user";
import { now } from "~/lib/utils";
import { tasksCollection } from "~/lib/db/collections";
import { createOfflineTransaction } from "~/lib/db/offline";

/** Returns the new task's id. */
export const addTask = async (
  title: string,
  categoryId?: string | null,
  parentId?: string | null,
  description: string | null = null,
) => {
  // An insert before the first load settles can leave the collection stuck loading (signed
  // out, its sync never completes), and the sort order below needs the loaded siblings.
  await tasksCollection.stateWhenReady();

  const userId = getCurrentUserId();

  const allTasks = [...(tasksCollection.state?.values() ?? [])];
  const siblings = allTasks.filter((t) => (parentId ? t.parentId === parentId : !t.parentId));
  const sortOrder = keyAfter(siblings.map((t) => t.sortOrder));

  const timestamp = now();
  const id = nanoid();
  const tx = createOfflineTransaction({ mutationFnName: "syncTasks" });
  tx.mutate(() =>
    tasksCollection.insert({
      id,
      userId,
      categoryId: parentId ? null : (categoryId ?? null),
      assigneeId: null,
      sentById: null,
      parentId: parentId ?? null,
      title,
      status: "todo",
      description,
      dueDate: null,
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp,
      editedAt: null,
      completedAt: null,
      deletedAt: null,
      subtasks: [],
      shares: [],
      assignee: null,
      sentBy: null,
      user: null,
    }),
  );
  return id;
};
