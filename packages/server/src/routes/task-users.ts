import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import taskRepo from "../db/task.repo";
import { NotFoundError } from "../db/errors";
import { broadcast } from "../broadcast";

type Access = Awaited<ReturnType<typeof taskRepo.accessTo>>;

/** task_access has a row per way in; this is each person's widest. */
export const widest = (rows: Access) => {
  const byUser = new Map<string, Access[number]>();
  for (const row of rows) {
    const held = byUser.get(row.userId);
    byUser.set(row.userId, {
      ...row,
      canEdit: row.canEdit || !!held?.canEdit,
      canDelete: row.canDelete || !!held?.canDelete,
    });
  }
  return [...byUser.values()];
};

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
  const [task, rows] = await Promise.all([
    taskRepo.findById(id, { deleted }),
    taskRepo.accessTo([id]),
  ]);
  const access = widest(rows);
  const mine = access.find((a) => a.userId === userId);
  if (!mine) throw new NotFoundError("task", id);
  if ((action === "edit" && !mine.canEdit) || (action === "delete" && !mine.canDelete))
    throw new HTTPException(403, { message: "Not authorized" });
  return { task, mine, audience: access.map((a) => a.userId) };
};

/** Everyone a task reaches now, for a change that may have moved it. */
export const audienceOf = async (taskId: string) =>
  widest(await taskRepo.accessTo([taskId])).map((a) => a.userId);

/**
 * A note or subtask on the task was added or edited, so the task counts as edited too, when the
 * user may edit it. Its own write has already succeeded, so a failure here is only logged.
 */
export const markTaskEdited = async (
  c: Context,
  taskId: string,
  userId: string,
  at: string,
  access?: Access,
) => {
  try {
    const reach = access ?? (await taskRepo.accessTo([taskId]));
    if (!reach.some((a) => a.userId === userId && a.canEdit)) return;
    const row = await taskRepo.markEdited(taskId, at);
    const audience = widest(reach).map((a) => a.userId);
    if (row) broadcast(c, "tasks", "update", row, audience);
  } catch (err) {
    console.error(`[tasks] couldn't mark ${taskId} edited`, err);
  }
};
