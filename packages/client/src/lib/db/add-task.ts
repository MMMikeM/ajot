import { nanoid } from "nanoid";
import { keyAfter } from "@newtab-todo/shared/sort-order";
import { getCurrentUserId } from "~/lib/auth/current-user";
import { now } from "~/lib/utils";
import { tasksCollection } from "~/lib/db/collections";
import { createOfflineTransaction } from "~/lib/db/offline";

export const addTask = async (
  title: string,
  categoryId?: string | null,
  parentId?: string | null,
) => {
  // An insert before the first load settles can leave the collection stuck loading (signed
  // out, its sync never completes), and the sort order below needs the loaded siblings.
  await tasksCollection.stateWhenReady();

  const userId = getCurrentUserId();

  const allTasks = [...(tasksCollection.state?.values() ?? [])];
  const siblings = allTasks.filter((t) => (parentId ? t.parentId === parentId : !t.parentId));
  const sortOrder = keyAfter(siblings.map((t) => t.sortOrder));

  const timestamp = now();
  const tx = createOfflineTransaction({ mutationFnName: "syncTasks" });
  tx.mutate(() =>
    tasksCollection.insert({
      id: nanoid(),
      userId,
      categoryId: parentId ? null : (categoryId ?? null),
      assigneeId: null,
      parentId: parentId ?? null,
      title,
      status: "todo",
      description: null,
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
      user: null,
    }),
  );
};
