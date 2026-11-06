import {
  canFileShareIn,
  canMoveTo,
  placement as placementOf,
  type Placement,
} from "@newtab-todo/shared/task-access";
import { compareSortOrder } from "@newtab-todo/shared/sort-order";
import { asList, holders, type CategoriesById } from "~/lib/task-holders";
import type { Category, Task } from "~/lib/types";

export type { Placement };

const placement = (task: Task, userId: string, lists: CategoriesById): Placement =>
  placementOf({ ...task, category: holders(task, lists).category }, userId);

export const bySidebarOrder = (userId: string) => (a: Category, b: Category) =>
  Number(a.userId !== userId) - Number(b.userId !== userId) ||
  compareSortOrder(a.sortOrder, b.sortOrder);

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
