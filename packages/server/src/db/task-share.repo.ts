import { and, eq, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { taskShares } from "./schema";
import { InsertFailedError, NotFoundError } from "./errors";
import { limitedId } from "./field-limits";

export type Insert = typeof taskShares.$inferInsert;

export const idSchema = createSelectSchema(taskShares, { id: limitedId }).pick({ id: true });
export const responseSchema = createSelectSchema(taskShares);

// A share they already have keeps its id; only a new permission changes it
export const insert = async (data: Insert) => {
  const [row] = await db
    .insert(taskShares)
    .values(data)
    .onConflictDoUpdate({
      target: [taskShares.taskId, taskShares.sharedWithUserId],
      set: { permission: sql`excluded.permission` },
      setWhere: sql`${taskShares.permission} <> excluded.permission`,
    })
    .returning();
  if (row) return { share: row, added: row.id === data.id, changed: true };
  const existing = await db.query.taskShares.findFirst({
    where: { taskId: data.taskId, sharedWithUserId: data.sharedWithUserId },
  });
  if (!existing) throw new InsertFailedError("task share");
  return { share: existing, added: false, changed: false };
};

export const find = async (id: string) => {
  const row = await db.query.taskShares.findFirst({ where: { id } });
  if (!row) throw new NotFoundError("task share", id);
  return row;
};

export const remove = async (id: string) => {
  const [row] = await db.delete(taskShares).where(eq(taskShares.id, id)).returning();
  if (!row) throw new NotFoundError("task share", id);
  return row;
};

export const updateCategory = async (
  taskId: string,
  sharedWithUserId: string,
  categoryId: string | null,
) => {
  const [row] = await db
    .update(taskShares)
    .set({ categoryId })
    .where(and(eq(taskShares.taskId, taskId), eq(taskShares.sharedWithUserId, sharedWithUserId)))
    .returning();
  if (!row) throw new NotFoundError("task shared with you", taskId);
  return row;
};

export const listForTasks = async (taskIds: string[]) => {
  if (taskIds.length === 0) return [];
  return db.query.tasks.findMany({
    where: { id: { in: taskIds } },
    columns: { id: true },
    with: {
      shares: { with: { sharedWithUser: { columns: { id: true, name: true, username: true } } } },
    },
  });
};
