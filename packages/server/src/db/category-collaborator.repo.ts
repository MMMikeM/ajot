import { and, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db, inTransaction, type Transaction } from "./client";
import { categoryCollaborators, removedCollaborators, tasks, taskShares } from "./schema";
import { NotFoundError } from "./errors";
import { now } from "@newtab-todo/shared/iso";
import reachRepo from "./reach.repo";
import { undoableSince } from "./undo-window";

/** Someone in a list, as a collaborator row names them. */
type Membership = { categoryId: string; userId: string };

/** What someone leaving a list took out of it, so an Undo can put it back. */
type Leaving = Membership & { movedTaskIds: string[]; unfiledTaskIds: string[] };

/**
 * Adding someone afresh drops the Undo of their removal, which would move their tasks again. Null
 * when they were already in the list.
 */
const add = async (categoryId: string, userId: string) => {
  await db
    .delete(removedCollaborators)
    .where(
      and(eq(removedCollaborators.categoryId, categoryId), eq(removedCollaborators.userId, userId)),
    );
  const rows = await db
    .insert(categoryCollaborators)
    .values({ id: createId(), categoryId, userId })
    .onConflictDoNothing()
    .returning();
  return rows.at(0) ?? null;
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

/**
 * With who reached the list and its tasks before, for the broadcast. `keepForUndo` records what it
 * changed for restore: only for the owner removing someone, since Undo putting a leaver's tasks
 * back would undo their own choice.
 */
const remove = async (categoryId: string, userId: string, { keepForUndo = false } = {}) =>
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
    if (keepForUndo) {
      const record = {
        id: row.id,
        addedAt: row.addedAt,
        movedTaskIds: left!.movedTaskIds,
        unfiledTaskIds: left!.unfiledTaskIds,
        removedAt: now(),
      };
      await tx
        .delete(removedCollaborators)
        .where(lt(removedCollaborators.removedAt, undoableSince()));
      await tx
        .insert(removedCollaborators)
        .values({ ...record, categoryId, userId })
        .onConflictDoUpdate({
          target: [removedCollaborators.categoryId, removedCollaborators.userId],
          set: record,
        });
    }
    return { before, left: left! };
  });

/**
 * Undoes the owner's remove: the person is back in the list with their original row, and so is
 * what leaving took out of it, as far as rejoin finds it unchanged. Returns who reached the list
 * and those tasks before, and the ids of the tasks it changed.
 */
const restore = async (categoryId: string, userId: string) =>
  inTransaction(async (tx) => {
    const record = await tx.query.removedCollaborators.findFirst({
      where: { categoryId, userId, removedAt: { gte: undoableSince() } },
    });
    if (!record) throw new NotFoundError("removed collaborator");
    const leaving = {
      categoryId,
      userId,
      movedTaskIds: record.movedTaskIds,
      unfiledTaskIds: record.unfiledTaskIds,
    };
    const before = await reachRepo.read(
      { listIds: [categoryId], taskIds: [...record.movedTaskIds, ...record.unfiledTaskIds] },
      tx,
    );
    await tx
      .insert(categoryCollaborators)
      .values({ id: record.id, categoryId, userId, addedAt: record.addedAt })
      .onConflictDoNothing();
    const changed = await rejoin(tx, [leaving]);
    await tx.delete(removedCollaborators).where(eq(removedCollaborators.id, record.id));
    return { before, changed };
  });

export default { add, leave, rejoin, remove, restore };
