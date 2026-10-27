import type { Context } from "hono";
import taskRepo from "../db/task.repo";
import { broadcast } from "../broadcast";
import { canEditTask } from "../task-access";

export const taskUserIds = (task: {
  userId: string;
  shares?: { sharedWithUserId: string }[];
  category?: { collaborators: { userId: string }[] } | null;
  parent?: {
    userId: string;
    shares?: { sharedWithUserId: string }[];
    category?: { collaborators: { userId: string }[] } | null;
  } | null;
}) => [
  ...new Set([
    task.userId,
    ...(task.shares?.map((s) => s.sharedWithUserId) ?? []),
    ...(task.category?.collaborators.map((c) => c.userId) ?? []),
    // Subtasks have no shares or category of their own; everyone with the parent sees them
    ...(task.parent ? [task.parent.userId] : []),
    ...(task.parent?.shares?.map((s) => s.sharedWithUserId) ?? []),
    ...(task.parent?.category?.collaborators.map((c) => c.userId) ?? []),
  ]),
];

/**
 * A note or subtask on the task was added or edited, so the task counts as edited too. Its own
 * write has already succeeded, so a failure here is logged rather than failing the request.
 */
export const markTaskEdited = async (c: Context, taskId: string, userId: string, at: string) => {
  try {
    const task = await taskRepo.findByIdWithAccess(taskId, userId);
    if (!canEditTask(task, userId)) return;
    const row = await taskRepo.markEdited(taskId, at);
    if (row) broadcast(c, "tasks", "update", row, taskUserIds(task));
  } catch (err) {
    console.error(`[tasks] couldn't mark ${taskId} edited`, err);
  }
};
