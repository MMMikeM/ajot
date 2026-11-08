import { placement } from "@newtab-todo/shared/task-access";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import type { CategoryWithCollaborators } from "./db/category.repo";
import type * as taskRepo from "./db/task.repo";

type Task = Awaited<ReturnType<typeof taskRepo.list>>[number];

/**
 * The open tasks in `userId`'s Inbox, in the app's order: what the Android widget shows, worked
 * out here so the widget never carries its own copy of where a task appears.
 */
export const inboxOf = (tasks: Task[], lists: CategoryWithCollaborators[], userId: string) => {
  const byId = new Map(lists.map((list) => [list.id, list]));
  return tasks
    .filter((task) => {
      if (task.parentId || task.status === "done") return false;
      const category = task.categoryId ? (byId.get(task.categoryId) ?? null) : null;
      return placement({ ...task, category }, userId).categoryId === null;
    })
    .sort((a, b) => compareSortOrder(a.sortOrder, b.sortOrder));
};
