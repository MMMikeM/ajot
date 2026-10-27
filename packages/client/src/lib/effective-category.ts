import type { Task } from "~/lib/types";

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
 * Where a top-level task appears for `userId`. A task in a list they collaborate on stays in that
 * list: a share never overrides list membership.
 */
export const placement = (
  task: Task,
  userId: string,
  collaboratedCategoryIds: Set<string>,
): Placement => {
  if (task.userId === userId) return { mode: "owner", categoryId: task.categoryId ?? null };
  if (task.categoryId && collaboratedCategoryIds.has(task.categoryId))
    return { mode: "list", categoryId: task.categoryId };
  const myShare = task.shares.find((s) => s.sharedWithUserId === userId);
  if (myShare) return { mode: "share", categoryId: myShare.categoryId ?? null };
  return { mode: "list", categoryId: task.categoryId ?? undefined };
};

export const getEffectiveCategoryId = (
  task: Task,
  userId: string,
  collaboratedCategoryIds: Set<string>,
) => placement(task, userId, collaboratedCategoryIds).categoryId;

export const countOpenTasksByCategory = (
  tasks: Task[],
  userId: string,
  collaboratedCategoryIds: Set<string>,
) => {
  const counts = new Map<string | null, number>();
  for (const t of tasks) {
    if (t.parentId || t.status === "done") continue;
    const key = getEffectiveCategoryId(t, userId, collaboratedCategoryIds);
    if (key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
