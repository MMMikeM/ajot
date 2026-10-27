type Owned = { userId: string };

// The same rule DELETE /api/tasks enforces: a share or a shared list lets you edit a task, not delete it
export const canDeleteTask = (userId: string, task: Owned, parent?: Owned) =>
  task.userId === userId || parent?.userId === userId;

/**
 * Who moves a task to another list: its owner moves the task, someone it was shared with files
 * their share, and a collaborator in a shared list can't move it.
 */
export const filingMode = (
  userId: string,
  task: Owned & { shares: { sharedWithUserId: string }[] },
) =>
  task.userId === userId
    ? "owner"
    : task.shares.some((s) => s.sharedWithUserId === userId)
      ? "share"
      : "view";
