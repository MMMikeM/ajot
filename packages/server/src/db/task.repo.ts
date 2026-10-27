import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { db } from "./client";
import { categories, tasks, taskShares, users } from "./schema";
import { ConflictError, InsertFailedError, NotFoundError, StaleUpdateError } from "./errors";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { now } from "@newtab-todo/shared/iso";

export type TaskShareInsert = typeof taskShares.$inferInsert;

export const taskShareSelectSchema = createSelectSchema(taskShares).pick({ id: true });
export const taskShareResponseSchema = createSelectSchema(taskShares);

export type TaskInsert = typeof tasks.$inferInsert;

export const taskSelectSchema = createSelectSchema(tasks).pick({ id: true });
export const taskResponseSchema = createSelectSchema(tasks);

const sharedWithUserSchema = createSelectSchema(users).pick({
  id: true,
  name: true,
  username: true,
});

export const taskListItemSchema = taskResponseSchema.extend({
  user: z.object({ id: z.string(), name: z.string() }).nullable(),
  subtasks: z.array(taskResponseSchema),
  shares: z.array(
    taskShareResponseSchema.extend({
      sharedWithUser: sharedWithUserSchema.nullable(),
    }),
  ),
  assignee: sharedWithUserSchema.nullable(),
});
export const taskInsertSchema = createInsertSchema(tasks, {
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
})
  .required({ id: true, createdAt: true, updatedAt: true })
  .omit({ deletedAt: true });
// Deleting goes through DELETE; an update can only bring a deleted task back. Its owner and
// parent are fixed: a task taken, planted in someone's Inbox or hung under theirs would be theirs.
export const taskUpdateSchema = createUpdateSchema(tasks, { updatedAt: isoDatetime })
  .required({ id: true, updatedAt: true })
  .omit({ createdAt: true, userId: true, parentId: true })
  .extend({ deletedAt: z.null().optional() })
  .strict();

// task-access.ts's audience, as a query: the owner, a share's recipient, the list's people
const reachedBy = (userId: string) => [
  { userId },
  { shares: { sharedWithUserId: userId } },
  { category: { userId } },
  { category: { collaborators: { userId } } },
];

const list = async (userId: string) =>
  db.query.tasks.findMany({
    where: {
      deletedAt: { isNull: true },
      // Subtasks carry no shares or categoryId, so they're reached through their parent
      OR: [...reachedBy(userId), ...reachedBy(userId).map((reach) => ({ parent: reach }))],
    },
    with: {
      user: { columns: { id: true, name: true } },
      subtasks: { where: { deletedAt: { isNull: true } } },
      shares: {
        with: {
          sharedWithUser: { columns: { id: true, name: true, username: true } },
        },
      },
      assignee: { columns: { id: true, name: true, username: true } },
    },
    orderBy: { sortOrder: "asc", createdAt: "asc" },
  });

const findById = async (id: string) => {
  const row = await db.query.tasks.findFirst({ where: { id, deletedAt: { isNull: true } } });
  if (!row) throw new NotFoundError("task", id);
  return row;
};

// What task-access.ts reads, for a task and for its parent
const holderWith = {
  shares: { columns: { sharedWithUserId: true, permission: true } },
  category: {
    columns: { id: true, userId: true },
    with: { collaborators: { columns: { userId: true } } },
  },
} as const;

/** A deleted task reads as missing, unless asked for by the restore that brings it back. */
const findByIdWithAccess = async (id: string, { deleted = false } = {}) => {
  const row = await db.query.tasks.findFirst({
    where: deleted ? { id } : { id, deletedAt: { isNull: true } },
    with: {
      ...holderWith,
      parent: { columns: { id: true, userId: true, deletedAt: true }, with: holderWith },
    },
  });
  if (!row) throw new NotFoundError("task", id);
  return row;
};

// A retried insert gets the stored row back unchanged: the no-op update lets RETURNING yield it.
// Re-inserting a deleted task, as Undo did before restores went through update, restores it.
// An id someone else's task already has updates nothing, so it returns nothing and restores nothing.
const insert = async (data: TaskInsert) => {
  const [row] = await db
    .insert(tasks)
    .values(data)
    .onConflictDoUpdate({
      target: tasks.id,
      set: { updatedAt: sql`${tasks.updatedAt}`, deletedAt: sql`null` },
      setWhere: eq(tasks.userId, data.userId),
    })
    .returning();
  if (!row) throw new ConflictError("Task id taken");
  return row;
};

/**
 * A task sent to someone, which they own. A retried send gets the row back; an id one of their
 * tasks already has, made at another moment, doesn't, so it can't be read or brought back.
 */
const insertSent = async (data: TaskInsert & Required<Pick<TaskInsert, "createdAt">>) => {
  const [row] = await db
    .insert(tasks)
    .values(data)
    .onConflictDoUpdate({
      target: tasks.id,
      set: { updatedAt: sql`${tasks.updatedAt}` },
      setWhere: and(eq(tasks.userId, data.userId), eq(tasks.createdAt, data.createdAt)),
    })
    .returning();
  if (!row) throw new ConflictError("Task id taken");
  return row;
};

const update = async (id: string, updatedAt: string, fields: Partial<TaskInsert>) => {
  const [row] = await db
    .update(tasks)
    .set({ ...fields, updatedAt })
    .where(and(eq(tasks.id, id), lt(tasks.updatedAt, updatedAt)))
    .returning();
  if (!row) throw new StaleUpdateError("task", id);
  return row;
};

// Leaves updatedAt, the sync clock, alone: a note or subtask changing must not beat a pending
// edit to the task itself. Undefined when the task was already edited later than `at`.
const markEdited = async (id: string, at: string) => {
  const [row] = await db
    .update(tasks)
    .set({ editedAt: at })
    .where(and(eq(tasks.id, id), or(isNull(tasks.editedAt), lt(tasks.editedAt, at))))
    .returning();
  return row;
};

// After the user's other top-level tasks, where the app puts a task they add themselves
const nextSortOrder = async (userId: string) => {
  const last = await db.query.tasks.findFirst({
    where: { userId, parentId: { isNull: true }, sortOrder: { isNotNull: true } },
    columns: { sortOrder: true },
    orderBy: { sortOrder: "desc" },
  });
  return generateKeyBetween(last?.sortOrder ?? null, null);
};

/**
 * Hides the task and its subtasks, keeping their shares, notes and reminders for a restore.
 * Bumping updatedAt makes the delete win over older offline edits.
 */
const remove = async (id: string) => {
  const at = now();
  const rows = await db
    .update(tasks)
    .set({ deletedAt: at, updatedAt: at })
    .where(and(or(eq(tasks.id, id), eq(tasks.parentId, id)), isNull(tasks.deletedAt)))
    .returning();
  const task = rows.find((row) => row.id === id);
  if (!task) throw new NotFoundError("task", id);
  return { task, subtaskIds: rows.filter((row) => row.id !== id).map((row) => row.id) };
};

// Null when the task's list has been deleted since, so the task comes back in the Inbox
const liveCategoryId = sql<string | null>`(select ${categories.id} from ${categories}
  where ${categories.id} = ${tasks.categoryId} and ${categories.deletedAt} is null)`;

/**
 * Undoes a delete. It skips the stale check update makes: the delete was stamped by the server's
 * clock and the restore by the device's, and a restore always comes after the delete it undoes.
 */
const restore = async (id: string, updatedAt: string) => {
  const [row] = await db
    .update(tasks)
    .set({
      deletedAt: null,
      categoryId: liveCategoryId,
      updatedAt: sql`max(${tasks.updatedAt}, ${updatedAt})`,
    })
    .where(eq(tasks.id, id))
    .returning();
  if (!row) throw new NotFoundError("task", id);
  return row;
};

const listItemWith = {
  user: { columns: { id: true, name: true } },
  subtasks: { where: { deletedAt: { isNull: true } } },
  shares: {
    with: {
      sharedWithUser: { columns: { id: true, name: true, username: true } },
    },
  },
  assignee: { columns: { id: true, name: true, username: true } },
} as const;

/** A task in the shape the list sends, for broadcasting one that's back. */
const findListItem = async (id: string) => {
  const row = await db.query.tasks.findFirst({
    where: { id, deletedAt: { isNull: true } },
    with: listItemWith,
  });
  if (!row) throw new NotFoundError("task", id);
  return row;
};

const findListItems = async (ids: string[]) => {
  if (ids.length === 0) return [];
  return db.query.tasks.findMany({
    where: { id: { in: ids }, deletedAt: { isNull: true } },
    with: listItemWith,
  });
};

export type TaskWithRelations = Awaited<ReturnType<typeof list>>[number];

const insertShare = async (data: TaskShareInsert) => {
  const [row] = await db.insert(taskShares).values(data).returning();
  if (!row) throw new InsertFailedError("task share");
  return row;
};

// Someone else's share reads as missing, so its id can't be probed
const removeShare = async (id: string, ownerId: string) => {
  const ownedTaskIds = db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, ownerId));
  const [row] = await db
    .delete(taskShares)
    .where(and(eq(taskShares.id, id), inArray(taskShares.taskId, ownedTaskIds)))
    .returning();
  if (!row) throw new NotFoundError("task share", id);
  return row;
};

const updateShareCategory = async (
  taskId: string,
  sharedWithUserId: string,
  categoryId: string | null,
) => {
  const [row] = await db
    .update(taskShares)
    .set({ categoryId })
    .where(and(eq(taskShares.taskId, taskId), eq(taskShares.sharedWithUserId, sharedWithUserId)))
    .returning();
  if (!row) throw new NotFoundError("task share", taskId);
  return row;
};

/** Each task's shares, in the shape the task list sends them. */
const listSharesForTasks = async (taskIds: string[]) => {
  if (taskIds.length === 0) return [];
  return db.query.tasks.findMany({
    where: { id: { in: taskIds } },
    columns: { id: true },
    with: {
      shares: { with: { sharedWithUser: { columns: { id: true, name: true, username: true } } } },
    },
  });
};

const findOverdue = async (beforeDate: string) =>
  db.query.tasks.findMany({
    where: {
      dueDate: { lt: beforeDate },
      status: { in: ["todo", "in_progress"] },
      deletedAt: { isNull: true },
    },
    columns: { id: true, title: true, dueDate: true, userId: true },
  });

export default {
  list,
  findById,
  findByIdWithAccess,
  insert,
  insertSent,
  update,
  markEdited,
  remove,
  restore,
  findListItem,
  findListItems,
  nextSortOrder,
  insertShare,
  removeShare,
  updateShareCategory,
  listSharesForTasks,
  findOverdue,
};
