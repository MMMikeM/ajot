import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db, inTransaction, type Transaction } from "./client";
import { categoryCollaborators, tasks, taskShares } from "./schema";
import { NotFoundError } from "./errors";
import { now } from "@newtab-todo/shared/iso";
import reachRepo from "./reach.repo";

/** Someone in a list, as a collaborator row names them. */
type Membership = { categoryId: string; userId: string };

/** What someone leaving a list took out of it, so an Undo can put it back. */
type Leaving = Membership & { movedTaskIds: string[]; unfiledTaskIds: string[] };

const add = async (categoryId: string, userId: string) => {
  const [row] = await db
    .insert(categoryCollaborators)
    .values({ id: createId(), categoryId, userId })
    .onConflictDoNothing()
    .returning();
  return row;
};

/**
 * Whoever leaves a list can't see it any more, so their tasks in it go to their Inbox, hidden ones
 * too so restoring one doesn't put it back there, and their shares filed there are unfiled.
 */
const leave = async (tx: Transaction, memberships: Membership[]): Promise<Leaving[]> => {
  if (memberships.length === 0) return [];
  const theirTasks = await tx.query.tasks.findMany({
    where: { OR: memberships.map(({ categoryId, userId }) => ({ categoryId, userId })) },
    columns: { id: true, categoryId: true, userId: true },
  });
  const theirShares = await tx.query.taskShares.findMany({
    where: {
      OR: memberships.map(({ categoryId, userId }) => ({ categoryId, sharedWithUserId: userId })),
    },
    columns: { id: true, taskId: true, categoryId: true, sharedWithUserId: true },
  });
  if (theirTasks.length > 0)
    await tx
      .update(tasks)
      .set({ categoryId: null, updatedAt: now() })
      .where(
        inArray(
          tasks.id,
          theirTasks.map((t) => t.id),
        ),
      );
  if (theirShares.length > 0)
    await tx
      .update(taskShares)
      .set({ categoryId: null })
      .where(
        inArray(
          taskShares.id,
          theirShares.map((s) => s.id),
        ),
      );
  return memberships.map((m) => ({
    ...m,
    movedTaskIds: theirTasks
      .filter((t) => t.categoryId === m.categoryId && t.userId === m.userId)
      .map((t) => t.id),
    unfiledTaskIds: theirShares
      .filter((s) => s.categoryId === m.categoryId && s.sharedWithUserId === m.userId)
      .map((s) => s.taskId),
  }));
};

// Each row's own list, in one statement for all of them
const listFor = (cases: { when: SQL | undefined; categoryId: string }[]) =>
  sql`CASE ${sql.join(
    cases.map(({ when, categoryId }) => sql`WHEN ${when} THEN ${categoryId}`),
    sql` `,
  )} END`;

/**
 * Undoes leave for someone back in the lists. A task or share changed since stays where it went:
 * moved back only from the Inbox, refiled only if still unfiled. The ids of the tasks it changed.
 */
const rejoin = async (tx: Transaction, leavings: Leaving[]) => {
  const moved = leavings.flatMap((l) => l.movedTaskIds.map((id) => ({ ...l, id })));
  const unfiled = leavings.flatMap((l) => l.unfiledTaskIds.map((taskId) => ({ ...l, taskId })));
  const movedBack =
    moved.length > 0
      ? await tx
          .update(tasks)
          .set({
            categoryId: listFor(moved.map((m) => ({ ...m, when: eq(tasks.id, m.id) }))),
            updatedAt: now(),
          })
          .where(
            and(
              inArray(
                tasks.id,
                moved.map((m) => m.id),
              ),
              isNull(tasks.categoryId),
            ),
          )
          .returning({ id: tasks.id })
      : [];
  const isTheirs = (s: (typeof unfiled)[number]) =>
    and(eq(taskShares.taskId, s.taskId), eq(taskShares.sharedWithUserId, s.userId));
  const refiled =
    unfiled.length > 0
      ? await tx
          .update(taskShares)
          .set({ categoryId: listFor(unfiled.map((s) => ({ ...s, when: isTheirs(s) }))) })
          .where(and(or(...unfiled.map(isTheirs)), isNull(taskShares.categoryId)))
          .returning({ taskId: taskShares.taskId })
      : [];
  return [...movedBack.map((t) => t.id), ...refiled.map((s) => s.taskId)];
};

/** With who reached the list and its tasks before, for the broadcast. */
const remove = async (categoryId: string, userId: string) =>
  inTransaction(async (tx) => {
    const before = await reachRepo.read({ listIds: [categoryId] }, tx);
    const [row] = await tx
      .delete(categoryCollaborators)
      .where(
        and(
          eq(categoryCollaborators.categoryId, categoryId),
          eq(categoryCollaborators.userId, userId),
        ),
      )
      .returning();
    if (!row) throw new NotFoundError("category collaborator");
    const [left] = await leave(tx, [row]);
    return { before, left: left! };
  });

export default { add, leave, rejoin, remove };
