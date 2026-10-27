import type { Context } from "hono";
import { widest } from "@newtab-todo/shared/task-access";
import taskRepo, { type TaskAccessRow } from "../db/task.repo";
import { ForbiddenError, NotFoundError } from "../db/errors";
import { broadcast } from "../broadcast";

/** Everyone the rows say can reach a task, once each. */
export const audienceFrom = (access: TaskAccessRow[]) =>
  widest(access).map((grant) => grant.userId);

/**
 * The task, with the user's reach and everyone it reaches, if the user may do this to it. Someone
 * who can't see it gets the same 404 as for a task that doesn't exist, so its id can't be probed.
 */
export const requireTask = async (
  id: string,
  userId: string,
  action: "see" | "edit" | "delete",
  { deleted = false } = {},
) => {
  const { task, access } = await taskRepo.findWithAccess(id, { deleted });
  const mine = widest(access).find((grant) => grant.userId === userId);
  if (!task || !mine) throw new NotFoundError("task", id);
  if ((action === "edit" && !mine.canEdit) || (action === "delete" && !mine.canDelete))
    throw new ForbiddenError("Not authorized");
  return { task, mine, access, audience: audienceFrom(access) };
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
