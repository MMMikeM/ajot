import type { Context } from "hono";
import { widest } from "@newtab-todo/shared/task-access";
import taskRepo, { type TaskAccessRow } from "../db/task.repo";
import categoryRepo from "../db/category.repo";
import { ForbiddenError, NotFoundError } from "../db/errors";
import { broadcast } from "../broadcast";

export const audienceFrom = (access: TaskAccessRow[]) =>
  widest(access).map((grant) => grant.userId);

/**
 * The task, with the user's reach and everyone it reaches, if the user may do this to it: `manage`
 * is its owner's alone, to delete, restore, move or share it. Someone who can't see it gets the
 * same 404 as for a task that doesn't exist, so its id can't be probed.
 */
export const requireTask = async (
  id: string,
  userId: string,
  action: "see" | "edit" | "manage",
  { deleted = false } = {},
) => {
  const { task, access } = await taskRepo.findWithAccess(id, { deleted });
  const mine = widest(access).find((grant) => grant.userId === userId);
  if (!task || !mine) throw new NotFoundError("task", id);
  if (action === "edit" && !mine.canEdit)
    throw new ForbiddenError("This task is shared with you to view only.");
  if (action === "manage" && !mine.canDelete)
    throw new ForbiddenError("Only the task's owner can do that.");
  return { task, mine, access, audience: audienceFrom(access) };
};

/**
 * The list, if the user may do this to it: `use` is for its members, to add to it or leave it, and
 * `manage` its owner's alone, to rename, delete, restore or share it. Someone not in it gets the
 * same 404 as for a list that doesn't exist. A deleted list has no members, only its owner.
 */
export const requireList = async (
  id: string,
  userId: string,
  action: "use" | "manage",
  { deleted = false } = {},
) => {
  const [list, member] = await Promise.all([
    categoryRepo.findById(id, { deleted }),
    categoryRepo.canUse(id, userId),
  ]);
  const owns = list.userId === userId;
  if (!owns && !member) throw new NotFoundError("category", id);
  if (action === "manage" && !owns) throw new ForbiddenError("Only the list's owner can do that.");
  return list;
};

/** Everyone a task reaches now, for a change that may have moved it. */
export const audienceOf = async (taskId: string) => audienceFrom(await taskRepo.accessTo([taskId]));

/**
 * A note or subtask on the task was added or edited, so the task counts as edited too, when the
 * user may edit it. Its own write has already succeeded, so a failure here is only logged.
 */
export const markTaskEdited = async (
  c: Context,
  taskId: string,
  userId: string,
  at: string,
  access?: TaskAccessRow[],
) => {
  try {
    const reach = access ?? (await taskRepo.accessTo([taskId]));
    if (!reach.some((a) => a.userId === userId && a.canEdit)) return;
    const row = await taskRepo.markEdited(taskId, at);
    if (row) broadcast(c, "tasks", "update", row, audienceFrom(reach));
  } catch (err) {
    console.error(`[tasks] couldn't mark ${taskId} edited`, err);
  }
};
