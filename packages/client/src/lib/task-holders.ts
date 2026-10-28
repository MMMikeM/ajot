import type { TaskWithHolders } from "@newtab-todo/shared/task-access";
import type { Category, Task } from "~/lib/types";

export type CategoriesById = ReadonlyMap<string, Category>;

export const categoriesById = (categories: Category[]): CategoriesById =>
  new Map(categories.map((c) => [c.id, c]));

/** A list as `shared/task-access.ts` reads it. */
export const asList = (list: Category) => ({
  userId: list.userId,
  // A list made on another device arrives without its collaborators until the next fetch
  collaborators: list.collaborators ?? [],
});

const listOf = (task: Task, lists: CategoriesById) => {
  const list = task.categoryId ? lists.get(task.categoryId) : undefined;
  return list ? asList(list) : null;
};

/**
 * A task as `shared/task-access.ts` reads it: with its list, and its parent's for a subtask, as far
 * as this device has them. A list this user isn't in never reaches the device, so here it grants
 * no one.
 */
export const holders = (task: Task, lists: CategoriesById, parent?: Task): TaskWithHolders => ({
  userId: task.userId,
  shares: task.shares,
  category: listOf(task, lists),
  parent: parent && {
    userId: parent.userId,
    shares: parent.shares,
    category: listOf(parent, lists),
  },
});

/**
 * Who owns the task, by name: a task someone adds to a list arrives live without its owner, whose
 * name the list already has.
 */
export const ownerNameOf = (task: Task, lists: CategoriesById) => {
  if (task.user) return task.user.name;
  const list = task.categoryId ? lists.get(task.categoryId) : undefined;
  if (!list) return undefined;
  if (list.userId === task.userId) return list.user?.name;
  return list.collaborators?.find((c) => c.userId === task.userId)?.user.name;
};
