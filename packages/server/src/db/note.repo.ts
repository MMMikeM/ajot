import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { db, type Transaction } from "./client";
import { notes } from "./schema";
import { InsertFailedError, NotFoundError, StaleUpdateError } from "./errors";
import { isoDatetime, now } from "@newtab-todo/shared/iso";

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
export const noteUpdateSchema = createUpdateSchema(notes, { updatedAt: isoDatetime })
  .required({ id: true, updatedAt: true })
  .omit({ createdAt: true })
  .strict();

const list = async (userId: string) =>
  db.query.notes.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });

// A retried insert gets the stored row back unchanged: the no-op update lets RETURNING yield it
const insert = async (data: NoteInsert) => {
  const [row] = await db
    .insert(notes)
    .values(data)
    .onConflictDoUpdate({ target: notes.id, set: { updatedAt: sql`${notes.updatedAt}` } })
    .returning();
  if (!row) throw new InsertFailedError("note");
  return row;
};

const update = async (id: string, updatedAt: string, fields: Partial<NoteInsert>) => {
  const [row] = await db
    .update(notes)
    .set({ ...fields, updatedAt })
    .where(and(eq(notes.id, id), lt(notes.updatedAt, updatedAt)))
    .returning();
  if (!row) throw new StaleUpdateError("note", id);
  return row;
};

const remove = async (id: string) => {
  const [row] = await db.delete(notes).where(eq(notes.id, id)).returning();
  if (!row) throw new NotFoundError("note", id);
  return row;
};

/** Notes outlive their task. Bumping updatedAt makes the unlink win over older offline edits. */
const unlinkFromTasks = async (tx: Transaction, taskIds: string[]) => {
  if (taskIds.length === 0) return [];
  return tx
    .update(notes)
    .set({ taskId: null, updatedAt: now() })
    .where(inArray(notes.taskId, taskIds))
    .returning();
};

export default { list, insert, update, remove, unlinkFromTasks };
