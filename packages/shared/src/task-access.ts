/**
 * Who can reach a task, and how far. The server reads the `task_access` view in
 * `server/src/db/views.ts`, which is built from one SQL fragment per path below; this is the
 * same rule in JS, for checks a page makes offline. `task-access.test.ts` runs both on the same
 * rows, and both are keyed by `AccessPath`, so a path added to one fails to compile until the
 * other has it too.
 */
export type AccessPath = "owner" | "share" | "list";

export type Grant = { userId: string; canEdit: boolean; canDelete: boolean };

type List = { userId: string; collaborators: { userId: string }[] };

type Holder = {
  userId: string;
  shares?: { sharedWithUserId: string; permission: "view" | "edit" }[];
  category?: List | null;
};

export type TaskWithHolders = Holder & { parent?: Holder | null };

/** The server's `list_members` view. */
export const listMemberIds = (list: List) => [
  list.userId,
  ...list.collaborators.map((c) => c.userId),
];

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
      ? listMemberIds(holder.category).map((userId) => ({
          userId,
          canEdit: true,
          canDelete: false,
        }))
      : [],
} satisfies Record<AccessPath, (holder: Holder) => Grant[]>;

export const widest = <G extends Grant>(grants: G[]): G[] => {
  const byUser = new Map<string, G>();
  for (const grant of grants) {
    const held = byUser.get(grant.userId);
    byUser.set(grant.userId, {
      ...grant,
      canEdit: grant.canEdit || !!held?.canEdit,
      canDelete: grant.canDelete || !!held?.canDelete,
    });
  }
  return [...byUser.values()];
};

/** A subtask has no shares or list of its own: it goes with its parent's. */
export const grants = (task: TaskWithHolders): Grant[] =>
  widest(
    (task.parent ? [task, task.parent] : [task]).flatMap((holder) =>
      Object.values(grantsByPath).flatMap((grantsFor): Grant[] => grantsFor(holder)),
    ),
  );

/** A share or a shared list lets you edit a task, but only its owner deletes or restores it. */
export const canDeleteTask = (task: TaskWithHolders, userId: string) =>
  grants(task).some((grant) => grant.userId === userId && grant.canDelete);

export const canEditTask = (task: TaskWithHolders, userId: string) =>
  grants(task).some((grant) => grant.userId === userId && grant.canEdit);

/** The server's `categoryRepo.canUse`. */
const canFileIn = (list: List | null, userId: string) =>
  list === null || listMemberIds(list).includes(userId);

/** Only its owner moves a top-level task, which moves it for everyone (PUT /api/tasks). */
export const canMoveTo = (task: Holder, list: List | null, userId: string) =>
  canDeleteTask(task, userId) && canFileIn(list, userId);

/**
 * Someone it's shared with files their own share instead, which moves it for them alone
 * (PUT /api/tasks/share).
 */
export const canFileShareIn = (task: Holder, list: List | null, userId: string) =>
  !!task.shares?.some((s) => s.sharedWithUserId === userId) && canFileIn(list, userId);
