import { and, eq, ne } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/zod";
import { db } from "./client";
import { taskShares } from "./schema";
import { InsertFailedError, NotFoundError } from "./errors";
import { limitedId } from "./field-limits";

export type Insert = typeof taskShares.$inferInsert;

export const idSchema = createSelectSchema(taskShares, { id: limitedId }).pick({ id: true });
export const responseSchema = createSelectSchema(taskShares);

export const insert = async (data: Insert) => {
  const [row] = await db.insert(taskShares).values(data).onConflictDoNothing().returning();
  if (row) return { share: row, added: true, changed: true };
  const permission = data.permission ?? "edit";
  const [updated] = await db
    .update(taskShares)
    .set({ permission })
    .where(
      and(
        eq(taskShares.taskId, data.taskId),
        eq(taskShares.sharedWithUserId, data.sharedWithUserId),
        ne(taskShares.permission, permission),
      ),
    )
    .returning();
  if (updated) return { share: updated, added: false, changed: true };
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
