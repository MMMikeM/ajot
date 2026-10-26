import type { Task } from "./types";

/** Every subtask is done, so the open task itself is next */
export const isReadyToTick = (task: Task, subtasks: Task[]) =>
  task.status !== "done" && subtasks.length > 0 && subtasks.every((s) => s.status === "done");
