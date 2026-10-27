import { and, eq, lt, sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { notes } from "./schema";
import { ConflictError, NotFoundError, StaleUpdateError } from "./errors";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";

export type NoteInsert = typeof notes.$inferInsert;
export type NoteSelect = typeof notes.$inferSelect;

export const noteSelectSchema = createSelectSchema(notes).pick({ id: true });
export const noteResponseSchema = createSelectSchema(notes);
export const noteInsertSchema = createInsertSchema(notes, {
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
})
  .required({ id: true, createdAt: true, updatedAt: true })
  .strict();
// The fields a client may change. An edit sends only what changed, so it can leave out taskId,
// but it can't clear it.
export const noteUpdateSchema = createUpdateSchema(notes, { updatedAt: isoDatetime })
  .pick({ id: true, updatedAt: true, title: true, content: true, taskId: true })
  .required({ id: true, updatedAt: true })
  .strict();

// A deleted task's notes wait, hidden, for it to come back
const list = async (userId: string) =>
  db.query.notes.findMany({
    where: { userId, task: { deletedAt: { isNull: true } } },
    orderBy: { createdAt: "desc" },
  });

// A retried insert gets the stored row back unchanged: the no-op update lets RETURNING yield it.
// An id another note already has updates nothing, so someone else's note isn't sent back.
const insert = async (data: NoteInsert) => {
  const [row] = await db
    .insert(notes)
    .values(data)
    .onConflictDoUpdate({
      target: notes.id,
      set: { updatedAt: sql`${notes.updatedAt}` },
      setWhere: eq(notes.userId, data.userId),
    })
    .returning();
  if (!row) throw new ConflictError("Note id taken");
  return row;
};

const findOwn = async (id: string, userId: string) =>
  db.query.notes.findFirst({ where: { id, userId }, columns: { taskId: true } });

// Someone else's note reads as missing, as with a stale write, so its id can't be probed
const update = async (
  id: string,
  userId: string,
  updatedAt: string,
  fields: Partial<NoteInsert>,
) => {
  const [row] = await db
    .update(notes)
    .set({ ...fields, updatedAt })
    .where(and(eq(notes.id, id), eq(notes.userId, userId), lt(notes.updatedAt, updatedAt)))
    .returning();
  if (!row) throw new StaleUpdateError("note", id);
  return row;
};

const remove = async (id: string, userId: string) => {
  const [row] = await db
    .delete(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .returning();
  if (!row) throw new NotFoundError("note", id);
  return row;
};

export default { list, findOwn, insert, update, remove };
