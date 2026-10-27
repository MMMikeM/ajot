type Owned = { userId: string };

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
