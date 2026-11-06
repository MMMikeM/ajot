import { and, eq, inArray, lt, or } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { db, inTransaction, type Transaction } from "./client";
import { categoryCollaborators, contacts, removedContacts, taskShares } from "./schema";
import { now } from "@newtab-todo/shared/iso";
import { NotFoundError } from "./errors";
import * as userRepo from "./user.repo";
import * as categoryCollaboratorRepo from "./category-collaborator.repo";
import { undoableSince } from "./undo-window";
import * as reachRepo from "./reach.repo";

export const responseSchema = createSelectSchema(contacts).extend({
  contactUser: userRepo.publicSchema,
});

type ShareRow = typeof taskShares.$inferSelect;

const withContactUser = { contactUser: { columns: userRepo.publicColumns } } as const;

export const list = async (userId: string) =>
  db.query.contacts.findMany({ where: { userId }, with: withContactUser });

export type ContactWithUser = Awaited<ReturnType<typeof list>>[number];

export const listByIds = async (ids: string[]): Promise<ContactWithUser[]> => {
  if (ids.length === 0) return [];
  return db.query.contacts.findMany({ where: { id: { in: ids } }, with: withContactUser });
};

export const exists = async (userId: string, contactUserId: string): Promise<boolean> => {
  const row = await db.query.contacts.findFirst({
    where: { userId, contactUserId },
    columns: { id: true },
  });
  return !!row;
};

export const findContactUser = async (userId: string, username: string) => {
  const row = await db.query.contacts.findFirst({
    where: { userId, contactUser: { username } },
    with: withContactUser,
  });
  return row?.contactUser;
};

// One transaction: deleting only one direction would leave one user still seeing the other.
// Sharing needs a contact, so each leaves the lists the other shared with them and loses the tasks
// the other shared with them; what each owns stays theirs. The read is inside it too: two removals
// at once could otherwise both find the contact, and the second would overwrite the first's Undo
// record with nothing.
export const remove = async (id: string, userId: string) =>
  inTransaction(async (tx) => {
    const contact = await tx.query.contacts.findFirst({ where: { id, userId } });
    if (!contact) throw new NotFoundError("contact", id);
    const otherId = contact.contactUserId;
    const shared = await tx.query.categoryCollaborators.findMany({
      where: {
        OR: [
          { userId: otherId, category: { userId } },
          { userId, category: { userId: otherId } },
        ],
      },
    });
    const sharedTasks = await tx.query.taskShares.findMany({
      where: {
        OR: [
          { sharedWithUserId: otherId, task: { userId } },
          { sharedWithUserId: userId, task: { userId: otherId } },
        ],
      },
    });
    const listIds = [...new Set(shared.map((c) => c.categoryId))];
    const unsharedTaskIds = [...new Set(sharedTasks.map((s) => s.taskId))];
    const before = await reachRepo.read({ listIds, taskIds: unsharedTaskIds }, tx);
    const removed = await tx
      .delete(contacts)
      .where(
        or(
          and(eq(contacts.userId, userId), eq(contacts.contactUserId, otherId)),
          and(eq(contacts.userId, otherId), eq(contacts.contactUserId, userId)),
        ),
      )
      .returning();
    if (shared.length > 0)
      await tx.delete(categoryCollaborators).where(
        inArray(
          categoryCollaborators.id,
          shared.map((c) => c.id),
        ),
      );
    if (sharedTasks.length > 0)
      await tx.delete(taskShares).where(
        inArray(
          taskShares.id,
          sharedTasks.map((s) => s.id),
        ),
      );
    const leavings = await categoryCollaboratorRepo.leave(tx, shared);
    const collaborators = shared.map((row, i) => {
      const { movedTaskIds, unfiledTaskIds } = leavings[i]!;
      return { ...row, left: { movedTaskIds, unfiledTaskIds } };
    });
    await tx.delete(removedContacts).where(lt(removedContacts.removedAt, undoableSince()));
    await tx
      .insert(removedContacts)
      .values({ id: contact.id, userId, contacts: removed, collaborators, shares: sharedTasks })
      .onConflictDoUpdate({
        target: removedContacts.id,
        set: { contacts: removed, collaborators, shares: sharedTasks, removedAt: now() },
      });
    const changed = [
      ...leavings.flatMap((l) => [...l.movedTaskIds, ...l.unfiledTaskIds]),
      // Their owners keep them, with one share fewer
      ...unsharedTaskIds,
    ];
    return { contact, removed, before, changed };
  });

/**
 * The shares whose task is still there, each filed where it was unless that list has gone since.
 * A task its owner deleted keeps its share, for that task's own Undo.
 */
const sharesStillPossible = async (tx: Transaction, shares: ShareRow[]) => {
  if (shares.length === 0) return [];
  const [taskRows, listRows] = await Promise.all([
    tx.query.tasks.findMany({
      where: { id: { in: shares.map((s) => s.taskId) } },
      columns: { id: true },
    }),
    tx.query.categories.findMany({
      where: {
        id: { in: shares.flatMap((s) => (s.categoryId ? [s.categoryId] : [])) },
        deletedAt: { isNull: true },
      },
      columns: { id: true },
    }),
  ]);
  const tasksThere = new Set(taskRows.map((t) => t.id));
  const listsThere = new Set(listRows.map((l) => l.id));
  const filedIn = (categoryId: string | null) =>
    categoryId && listsThere.has(categoryId) ? categoryId : null;
  return shares
    .filter((s) => tasksThere.has(s.taskId))
    .map((s) => ({ ...s, categoryId: filedIn(s.categoryId) }));
};

/** A replay after a lost response finds the contact already back and changes nothing. */
export const restore = async (id: string, userId: string) =>
  inTransaction(async (tx) => {
    const record = await tx.query.removedContacts.findFirst({
      where: { id, userId, removedAt: { gte: undoableSince() } },
    });
    if (!record) {
      const contact = await tx.query.contacts.findFirst({ where: { id, userId } });
      if (!contact) throw new NotFoundError("removed contact", id);
      return { contact, restored: [], before: await reachRepo.read({}, tx), changed: [] };
    }
    const contact = record.contacts.find((c) => c.id === id);
    if (!contact) throw new NotFoundError("contact", id);

    const restored =
      record.contacts.length > 0
        ? await tx.insert(contacts).values(record.contacts).onConflictDoNothing().returning()
        : [];
    const liveCategoryIds = new Set(
      (
        await tx.query.categories.findMany({
          where: {
            id: { in: record.collaborators.map((c) => c.categoryId) },
            deletedAt: { isNull: true },
          },
          columns: { id: true },
        })
      ).map((c) => c.id),
    );
    const back = record.collaborators.filter((c) => liveCategoryIds.has(c.categoryId));
    const leavings = back.map(({ categoryId, userId, left }) => ({
      categoryId,
      userId,
      movedTaskIds: left?.movedTaskIds ?? [],
      unfiledTaskIds: left?.unfiledTaskIds ?? [],
    }));
    const sharesBack = await sharesStillPossible(tx, record.shares);
    const resharedTaskIds = [...new Set(sharesBack.map((s) => s.taskId))];
    const taskIds = [
      ...leavings.flatMap((l) => [...l.movedTaskIds, ...l.unfiledTaskIds]),
      ...resharedTaskIds,
    ];
    const before = await reachRepo.read({ listIds: [...liveCategoryIds], taskIds }, tx);
    if (back.length > 0)
      await tx
        .insert(categoryCollaborators)
        .values(back.map(({ left: _left, ...row }) => row))
        .onConflictDoNothing();
    // A share made again since keeps its own id and permission
    if (sharesBack.length > 0) await tx.insert(taskShares).values(sharesBack).onConflictDoNothing();
    const changed = [...(await categoryCollaboratorRepo.rejoin(tx, leavings)), ...resharedTaskIds];
    await tx.delete(removedContacts).where(eq(removedContacts.id, id));
    return { contact, restored, before, changed };
  });
