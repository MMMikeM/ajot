/**
 * Who can reach a task, and how far. The server reads the `task_access` view in
 * `server/src/db/schema.ts`, which is built from one SQL fragment per path below; this is the
 * same rule in JS, for checks a page makes offline. `task-access.test.ts` runs both on the same
 * rows, and both are keyed by `AccessPath`, so a path added to one fails to compile until the
 * other has it too.
 */
export type AccessPath =
  /** The task's owner */
  | "owner"
  /** Whoever it's shared with, to view or to edit */
  | "share"
  /** The owner and collaborators of the list it's in */
  | "list";

export type Grant = { userId: string; canEdit: boolean; canDelete: boolean };

type Holder = {
  userId: string;
  shares?: { sharedWithUserId: string; permission: "view" | "edit" }[];
  category?: { userId: string; collaborators: { userId: string }[] } | null;
};

export type TaskWithHolders = Holder & { parent?: Holder | null };

const grantsByPath = {
  owner: (holder) => [{ userId: holder.userId, canEdit: true, canDelete: true }],
  share: (holder) =>
    (holder.shares ?? []).map((s) => ({
      userId: s.sharedWithUserId,
      canEdit: s.permission === "edit",
      canDelete: false,
    })),
  list: (holder) =>
    holder.category
      ? [holder.category.userId, ...holder.category.collaborators.map((c) => c.userId)].map(
          (userId) => ({ userId, canEdit: true, canDelete: false }),
        )
      : [],
} satisfies Record<AccessPath, (holder: Holder) => Grant[]>;

/** Each person's widest reach. A subtask has no shares or list of its own: it goes with its parent's. */
export const grants = (task: TaskWithHolders): Grant[] => {
  const byUser = new Map<string, Grant>();
  for (const holder of task.parent ? [task, task.parent] : [task])
    for (const grantsFor of Object.values(grantsByPath))
      for (const grant of grantsFor(holder)) {
        const held = byUser.get(grant.userId);
        byUser.set(grant.userId, {
          userId: grant.userId,
          canEdit: grant.canEdit || !!held?.canEdit,
          canDelete: grant.canDelete || !!held?.canDelete,
        });
      }
  return [...byUser.values()];
};

/** A share or a shared list lets you edit a task, but only its owner deletes or restores it. */
export const canDeleteTask = (task: TaskWithHolders, userId: string) =>
  grants(task).some((grant) => grant.userId === userId && grant.canDelete);
