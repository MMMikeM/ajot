import type { Context } from "hono";
import { widest } from "@newtab-todo/shared/task-access";
import * as taskRepo from "../db/task.repo";
import * as categoryRepo from "../db/category.repo";
import { HTTPException } from "hono/http-exception";
import { ForbiddenError, NotFoundError } from "../db/errors";
import { broadcast } from "../broadcast";

export const audienceFrom = (access: taskRepo.AccessRow[]) =>
  widest(access).map((grant) => grant.userId);

type TaskAction = "see" | "edit" | "manage";

/**
 * Someone who can't see it gets the same 404 as for a task that doesn't exist, so its id can't be
 * probed.
 */
const allowedOn = (
  id: string,
  userId: string,
  action: TaskAction,
  { task, access }: taskRepo.WithAccess,
) => {
  const mine = widest(access).find((grant) => grant.userId === userId);
  if (!task || !mine) throw new NotFoundError("task", id);
  if (action === "edit" && !mine.canEdit)
    throw new ForbiddenError("This task is shared with you to view only.");
  if (action === "manage" && !mine.canDelete)
    throw new ForbiddenError("Only the task's owner can do that.");
  return { task, mine, access, audience: audienceFrom(access) };
};

export const requireTask = async (
  id: string,
  userId: string,
  action: TaskAction,
  { deleted = false } = {},
) => allowedOn(id, userId, action, await taskRepo.findWithAccess(id, { deleted }));

const NOT_FOUND: taskRepo.WithAccess = { task: undefined, access: [] };

/** As `requireTask` for each live task, in one read, with each refusal returned in its place. */
export const requireTasks = async (ids: string[], userId: string, action: TaskAction) => {
  const found = await taskRepo.findAllWithAccess(ids);
  return ids.map((id) => {
    try {
      return { id, ...allowedOn(id, userId, action, found.get(id) ?? NOT_FOUND) };
    } catch (refusal) {
      if (refusal instanceof HTTPException) return { id, refusal };
      throw refusal;
    }
  });
};

/** A deleted list has no members, only its owner. */
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

export const audienceOf = async (taskId: string) => audienceFrom(await taskRepo.accessTo([taskId]));

/** The note's or subtask's own write has already succeeded, so a failure here is only logged. */
export const markTaskEdited = async (
  c: Context,
  taskId: string,
  userId: string,
  at: string,
  access?: taskRepo.AccessRow[],
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
