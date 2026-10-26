import { and, eq, inArray, or } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { createId } from "@paralleldrive/cuid2";
import { db, inTransaction } from "./client";
import { categories, categoryCollaborators, contacts, removedContacts } from "./schema";
import { now } from "@newtab-todo/shared/iso";
import { NotFoundError } from "./errors";
import { userPublicSchema } from "./user.repo";

export const contactResponseSchema = createSelectSchema(contacts).extend({
  contactUser: userPublicSchema.nullable(),
});

const list = async (userId: string) =>
  db.query.contacts.findMany({
    where: { userId },
    with: {
      contactUser: { columns: { id: true, name: true, username: true, avatarUrl: true } },
    },
  });

export type ContactWithUser = Awaited<ReturnType<typeof list>>[number];

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
// Sharing a list needs a contact, so the lists either one shared with the other stop being shared,
// and the record keeps all of it for Undo.
const remove = async (id: string, userId: string) => {
  const contact = await db.query.contacts.findFirst({ where: { id, userId } });
  if (!contact) throw new NotFoundError("contact", id);
  const otherId = contact.contactUserId;

  return inTransaction(async (tx) => {
    const removed = await tx
      .delete(contacts)
      .where(
        or(
          and(eq(contacts.userId, userId), eq(contacts.contactUserId, otherId)),
          and(eq(contacts.userId, otherId), eq(contacts.contactUserId, userId)),
        ),
      )
      .returning();
    const ownedBy = (ownerId: string) =>
      tx.select({ id: categories.id }).from(categories).where(eq(categories.userId, ownerId));
    const collaborators = await tx
      .delete(categoryCollaborators)
      .where(
        or(
          and(
            eq(categoryCollaborators.userId, otherId),
            inArray(categoryCollaborators.categoryId, ownedBy(userId)),
          ),
          and(
            eq(categoryCollaborators.userId, userId),
            inArray(categoryCollaborators.categoryId, ownedBy(otherId)),
          ),
        ),
      )
      .returning();
    await tx
      .insert(removedContacts)
      .values({ id: contact.id, userId, contacts: removed, collaborators })
      .onConflictDoUpdate({
        target: removedContacts.id,
        set: { contacts: removed, collaborators, removedAt: now() },
      });
    return { contact, collaborators };
  });
};

/**
 * Undoes remove for the user who removed the contact: both rows come back with their ids, and
 * so does sharing for each list that still exists. Rows that came back meanwhile through a new
 * invite are kept.
 */
const restore = async (id: string, userId: string) =>
  inTransaction(async (tx) => {
    const record = await tx.query.removedContacts.findFirst({ where: { id, userId } });
    if (!record) throw new NotFoundError("removed contact", id);

    if (record.contacts.length > 0)
      await tx.insert(contacts).values(record.contacts).onConflictDoNothing();
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
    const collaborators = record.collaborators.filter((c) => liveCategoryIds.has(c.categoryId));
    if (collaborators.length > 0)
      await tx.insert(categoryCollaborators).values(collaborators).onConflictDoNothing();
    await tx.delete(removedContacts).where(eq(removedContacts.id, id));

    const contact = record.contacts.find((c) => c.id === id);
    if (!contact) throw new NotFoundError("contact", id);
    return { contact, collaborators };
  });

export default { list, insert, exists, remove, restore };
