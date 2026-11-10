import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { taskShares, tasks } from "./schema";
import { InsertFailedError, NotFoundError } from "./errors";
import * as userRepo from "./user.repo";

export type Insert = typeof taskShares.$inferInsert;

export const responseSchema = createSelectSchema(taskShares);

// A retried add mustn't undo a change made since, such as a share turned to view, so a share
// someone already has stays as it is. Returns only the shares it added. A share removed between an
// add and its retry comes back: the retry can't tell it from one that never landed.
export const insertNew = async (rows: Insert[]) => {
  if (rows.length === 0) return [];
  return db.insert(taskShares).values(rows).onConflictDoNothing().returning();
};

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
    .where(
      and(
        eq(taskShares.taskId, taskId),
        eq(taskShares.sharedWithUserId, sharedWithUserId),
        inArray(
          taskShares.taskId,
          db
            .select({ id: tasks.id })
            .from(tasks)
            .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt))),
        ),
      ),
    )
    .returning();
  if (!row) throw new NotFoundError("task shared with you", taskId);
  return row;
};

export const withSharedWithUser = {
  sharedWithUser: { columns: userRepo.handleColumns },
} as const;

export const listForTasks = async (taskIds: string[]) => {
  if (taskIds.length === 0) return [];
  return db.query.tasks.findMany({
    where: { id: { in: taskIds }, deletedAt: { isNull: true } },
    columns: { id: true },
    with: { shares: { with: withSharedWithUser } },
  });
};
