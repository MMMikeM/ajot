import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import taskRepo from "../db/task.repo";
import { NotFoundError } from "../db/errors";
import { broadcast } from "../broadcast";
import {
  audience,
  canDeleteTask,
  canEditTask,
  canSeeTask,
  type TaskWithHolders,
} from "@newtab-todo/shared/task-access";

const allowed = { see: canSeeTask, edit: canEditTask, delete: canDeleteTask };

/**
 * The task, if the user may do this to it. Someone who can't see it gets the same 404 as for a
 * task that doesn't exist, so its id can't be probed.
 */
export const requireTask = async (
  id: string,
  userId: string,
  action: keyof typeof allowed,
  { deleted = false } = {},
) => {
  const task = await taskRepo.findByIdWithAccess(id, { deleted });
  if (!canSeeTask(task, userId)) throw new NotFoundError("task", id);
  if (!allowed[action](task, userId)) throw new HTTPException(403, { message: "Not authorized" });
  return task;
};

/**
 * A note or subtask on the task was added or edited, so the task counts as edited too. Its own
 * write has already succeeded, so a failure here is logged rather than failing the request.
 */
export const markTaskEdited = async (
  c: Context,
  task: TaskWithHolders & { id: string; deletedAt: string | null },
  userId: string,
  at: string,
) => {
  if (task.deletedAt || !canEditTask(task, userId)) return;
  try {
    const row = await taskRepo.markEdited(task.id, at);
    if (row) broadcast(c, "tasks", "update", row, audience(task));
  } catch (err) {
    console.error(`[tasks] couldn't mark ${task.id} edited`, err);
  }
};
