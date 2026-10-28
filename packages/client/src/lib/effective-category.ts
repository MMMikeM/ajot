import {
  canDeleteTask,
  canFileShareIn,
  canMoveTo,
  listMemberIds,
} from "@newtab-todo/shared/task-access";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import { asList, holders, type CategoriesById } from "~/lib/task-holders";
import type { Category, Task } from "~/lib/types";

export type Placement = {
  /**
   * How `userId` moves it to another list: `owner` moves the task, `share` files their share of
   * it, and `list` can't move it, since it sits in a list that's someone else's to arrange.
   */
  mode: "owner" | "share" | "list";
  /** The list it appears in: a category, `null` for the Inbox, `undefined` for nowhere. */
  categoryId: string | null | undefined;
};

/**
 * Where a top-level task appears for `userId`. A task in a list they're in stays in that list: a
 * share never overrides list membership, so filing one there would change nothing they can see.
 */
export const placement = (task: Task, userId: string, lists: CategoriesById): Placement => {
  const held = holders(task, lists);
  if (canDeleteTask(held, userId)) return { mode: "owner", categoryId: task.categoryId ?? null };
  if (held.category && listMemberIds(held.category).includes(userId))
    return { mode: "list", categoryId: task.categoryId };
  const myShare = task.shares.find((s) => s.sharedWithUserId === userId);
  if (myShare) return { mode: "share", categoryId: myShare.categoryId ?? null };
  return { mode: "list", categoryId: task.categoryId ?? undefined };
};

export const bySidebarOrder = (userId: string) => (a: Category, b: Category) =>
  Number(a.userId !== userId) - Number(b.userId !== userId) ||
  compareSortOrder(a.sortOrder, b.sortOrder);

/**
 * Where it appears for `userId`, and the lists besides the Inbox they can move it to: what the
 * sheet's List picker offers, and the only lists a drag onto the sidebar accepts.
 */
export const listChoices = (task: Task, userId: string, lists: CategoriesById) => {
  const where = placement(task, userId, lists);
  const held = holders(task, lists);
  const allowed = {
    owner: (list: Category) => canMoveTo(held, asList(list), userId),
    share: (list: Category) => canFileShareIn(held, asList(list), userId),
    list: () => false,
  }[where.mode];
  const choices = [...lists.values()].filter(allowed).sort(bySidebarOrder(userId));
  return { ...where, choices };
};

export const getEffectiveCategoryId = (task: Task, userId: string, lists: CategoriesById) =>
  placement(task, userId, lists).categoryId;

export const countOpenTasksByCategory = (tasks: Task[], userId: string, lists: CategoriesById) => {
  const counts = new Map<string | null, number>();
  for (const t of tasks) {
    if (t.parentId || t.status === "done") continue;
    const key = getEffectiveCategoryId(t, userId, lists);
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
