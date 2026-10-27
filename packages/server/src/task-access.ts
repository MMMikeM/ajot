type Holder = {
  userId: string;
  shares?: { sharedWithUserId: string; permission: "view" | "edit" }[];
  category?: { collaborators: { userId: string }[] } | null;
};

type TaskWithHolders = Holder & { parent?: Holder | null };

// Subtasks have no shares or category of their own; they go with their parent's
const holders = (task: TaskWithHolders) => (task.parent ? [task, task.parent] : [task]);

const ownsOrCollaborates = (holder: Holder, userId: string) =>
  holder.userId === userId || !!holder.category?.collaborators.some((c) => c.userId === userId);

export const canSeeTask = (task: TaskWithHolders, userId: string) =>
  holders(task).some(
    (holder) =>
      ownsOrCollaborates(holder, userId) ||
      !!holder.shares?.some((s) => s.sharedWithUserId === userId),
  );

/** A share or a shared list lets you edit a task, but only its owner deletes or restores it. */
export const canDeleteTask = (task: TaskWithHolders, userId: string) =>
  holders(task).some((holder) => holder.userId === userId);

/** A view share lets its recipient see the task and file it in their own list, nothing more. */
export const canEditTask = (task: TaskWithHolders, userId: string) =>
  holders(task).some(
    (holder) =>
      ownsOrCollaborates(holder, userId) ||
      !!holder.shares?.some((s) => s.sharedWithUserId === userId && s.permission === "edit"),
  );
