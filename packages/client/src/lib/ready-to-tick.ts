import type { Task } from "./types";

export const isReadyToTick = (task: Task, subtasks: Task[]) =>
  task.status !== "done" && subtasks.length > 0 && subtasks.every((s) => s.status === "done");
