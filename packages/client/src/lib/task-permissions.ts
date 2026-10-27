type Owned = { userId: string };

// The same rule DELETE /api/tasks enforces: a share or a shared list lets you edit a task, not delete it
export const canDeleteTask = (userId: string, task: Owned, parent?: Owned) =>
  task.userId === userId || parent?.userId === userId;

// Moving a task shared with you files your share; moving the task itself would move it for its owner
export const isSharedWith = (
  userId: string,
  task: Owned & { shares: { sharedWithUserId: string }[] },
) => task.userId !== userId && task.shares.some((s) => s.sharedWithUserId === userId);
