type Holder = {
  userId: string;
  shares?: { sharedWithUserId: string; permission: "view" | "edit" }[];
  category?: { collaborators: { userId: string }[] } | null;
};

export type TaskWithHolders = Holder & { parent?: Holder | null };

// Subtasks have no shares or category of their own; they go with their parent's
const holders = (task: TaskWithHolders) => (task.parent ? [task, task.parent] : [task]);

/** Everyone the task reaches: its owner, whoever it's shared with and its list's people. */
export const audience = (task: TaskWithHolders) => [
  ...new Set(
    holders(task).flatMap((holder) => [
      holder.userId,
      ...(holder.shares ?? []).map((s) => s.sharedWithUserId),
      ...(holder.category?.collaborators ?? []).map((c) => c.userId),
    ]),
  ),
];

export const canSeeTask = (task: TaskWithHolders, userId: string) =>
  audience(task).includes(userId);

/** A view share lets its recipient see the task and file it in their own list, nothing more. */
export const canEditTask = (task: TaskWithHolders, userId: string) =>
  holders(task).some(
    (holder) =>
      holder.userId === userId ||
      !!holder.category?.collaborators.some((c) => c.userId === userId) ||
      !!holder.shares?.some((s) => s.sharedWithUserId === userId && s.permission === "edit"),
  );

/** A share or a shared list lets you edit a task, but only its owner deletes or restores it. */
export const canDeleteTask = (task: TaskWithHolders, userId: string) =>
  holders(task).some((holder) => holder.userId === userId);
