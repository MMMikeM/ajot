import { and, eq, inArray, lt, or } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { createId } from "@paralleldrive/cuid2";
import { db, inTransaction } from "./client";
import { categoryCollaborators, contacts, removedContacts } from "./schema";
import { now } from "@newtab-todo/shared/iso";
import { NotFoundError } from "./errors";
import { userPublicSchema } from "./user.repo";
import categoryCollaboratorRepo from "./category-collaborator.repo";
import { undoableSince } from "./undo-window";
import reachRepo from "./reach.repo";

export const contactResponseSchema = createSelectSchema(contacts).extend({
  contactUser: userPublicSchema.nullable(),
});

const withContactUser = {
  contactUser: { columns: { id: true, name: true, username: true, avatarUrl: true } },
} as const;

const list = async (userId: string) =>
  db.query.contacts.findMany({ where: { userId }, with: withContactUser });

export type ContactWithUser = Awaited<ReturnType<typeof list>>[number];

/** As `list` has them, for the people whose rows they are. */
const listByIds = async (ids: string[]): Promise<ContactWithUser[]> => {
  if (ids.length === 0) return [];
  return db.query.contacts.findMany({ where: { id: { in: ids } }, with: withContactUser });
};

const insert = async (userId: string, contactUserId: string) => {
  const [row] = await db
    .insert(contacts)
    .values({ id: createId(), userId, contactUserId })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
};

const exists = async (userId: string, contactUserId: string): Promise<boolean> => {
  const row = await db.query.contacts.findFirst({
    where: { userId, contactUserId },
    columns: { id: true },
  });
  return !!row;
};

// One transaction: deleting only one direction would leave one user still seeing the other.
// Sharing a list needs a contact, so each leaves the lists the other shared with them, and the
// record keeps all of it for Undo. Returns who reached those lists and their tasks before.
const remove = async (id: string, userId: string) => {
  const contact = await db.query.contacts.findFirst({ where: { id, userId } });
  if (!contact) throw new NotFoundError("contact", id);
  const otherId = contact.contactUserId;

  return inTransaction(async (tx) => {
    const shared = await tx.query.categoryCollaborators.findMany({
      where: {
        OR: [
          { userId: otherId, category: { userId } },
          { userId, category: { userId: otherId } },
        ],
      },
    });
    const listIds = [...new Set(shared.map((c) => c.categoryId))];
    const before = await reachRepo.read({ listIds }, tx);
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
    const leavings = await categoryCollaboratorRepo.leave(tx, shared);
    const collaborators = shared.map((row, i) => {
      const { movedTaskIds, unfiledTaskIds } = leavings[i]!;
      return { ...row, left: { movedTaskIds, unfiledTaskIds } };
    });
    await tx.delete(removedContacts).where(lt(removedContacts.removedAt, undoableSince()));
    await tx
      .insert(removedContacts)
      .values({ id: contact.id, userId, contacts: removed, collaborators })
      .onConflictDoUpdate({
        target: removedContacts.id,
        set: { contacts: removed, collaborators, removedAt: now() },
      });
    const changed = leavings.flatMap((l) => [...l.movedTaskIds, ...l.unfiledTaskIds]);
    return { contact, removed, before, changed };
  });
};

/**
 * Undoes remove for the user who removed the contact, within an hour: both rows come back with
 * their ids, and so does sharing for each list that still exists, with what leaving it took out.
 * Rows that came back meanwhile through a new invite are kept. Returns the rows it put back, and
 * who reached it all before. A replay after a lost response finds the contact already back and
 * changes nothing.
 */
const restore = async (id: string, userId: string) =>
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
    const taskIds = leavings.flatMap((l) => [...l.movedTaskIds, ...l.unfiledTaskIds]);
    const before = await reachRepo.read({ listIds: [...liveCategoryIds], taskIds }, tx);
    if (back.length > 0)
      await tx
        .insert(categoryCollaborators)
        .values(back.map(({ left: _left, ...row }) => row))
        .onConflictDoNothing();
    const changed = await categoryCollaboratorRepo.rejoin(tx, leavings);
    await tx.delete(removedContacts).where(eq(removedContacts.id, id));
    return { contact, restored, before, changed };
  });

export default { list, listByIds, insert, exists, remove, restore };
