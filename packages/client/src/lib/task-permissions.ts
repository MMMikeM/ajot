type Owned = { userId: string };

// The same rule DELETE /api/tasks enforces: a share or a shared list lets you edit a task, not delete it
export const canDeleteTask = (userId: string, task: Owned, parent?: Owned) =>
  task.userId === userId || parent?.userId === userId;
