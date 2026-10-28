import { and, eq, getColumns, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { keyAfter } from "@newtab-todo/shared/sort-order";
import { keptSortOrder } from "./sort-key";
import { createInsertSchema, createSelectSchema, createUpdateSchema } from "drizzle-orm/zod";
import { z } from "@hono/zod-openapi";
import { db } from "./client";
import { categories, taskAccess, tasks, taskShares, users } from "./schema";
import { IdTakenError, InsertFailedError, NotFoundError, StaleUpdateError } from "./errors";
import { isoDatetime } from "@newtab-todo/shared/iso-schema";
import { now } from "@newtab-todo/shared/iso";
import { MAX_SHORT, MAX_TEXT, MAX_TITLE } from "@newtab-todo/shared/field-limits";
import { limited, limitedId } from "./field-limits";
import { notAfterNow, stampsNotAfterNow } from "./stamps";

export type TaskShareInsert = typeof taskShares.$inferInsert;

export const taskShareSelectSchema = createSelectSchema(taskShares, { id: limitedId }).pick({
  id: true,
});
export const taskShareResponseSchema = createSelectSchema(taskShares);

export type TaskInsert = typeof tasks.$inferInsert;

export const taskSelectSchema = createSelectSchema(tasks, { id: limitedId }).pick({ id: true });
export const taskResponseSchema = createSelectSchema(tasks).omit({ live: true });

// live only holds the database's rule about subtasks, so no read or write sends it
const hidden = { live: false } as const;
const { live: _live, ...sentColumns } = getColumns(tasks);

const sharedWithUserSchema = createSelectSchema(users).pick({
  id: true,
  name: true,
  username: true,
});

export const taskListItemSchema = taskResponseSchema.extend({
  user: z.object({ id: z.string(), name: z.string() }),
  subtasks: z.array(taskResponseSchema),
  shares: z.array(
    taskShareResponseSchema.extend({
      sharedWithUser: sharedWithUserSchema,
    }),
  ),
  assignee: sharedWithUserSchema.nullable(),
  sentBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
const limitedFields = {
  id: limitedId,
  userId: limitedId,
  categoryId: limitedId,
  assigneeId: limitedId,
  parentId: limitedId,
  title: limited("A task's title", MAX_TITLE),
  description: limited("A task's description", MAX_TEXT),
  dueDate: limited("A due date", MAX_SHORT),
  editedAt: limited("An edit's time", MAX_SHORT),
  completedAt: limited("A completion's time", MAX_SHORT),
};
export const taskInsertSchema = createInsertSchema(tasks, {
  ...limitedFields,
  createdAt: isoDatetime,
  updatedAt: isoDatetime,
})
  .required({ id: true, createdAt: true, updatedAt: true })
  .omit({ deletedAt: true, sentById: true });
// The fields a client may change, so a column added later isn't editable until it's listed. Its
// owner and parent are fixed: a task taken, planted in someone's Inbox or hung under theirs
// would be theirs. Deleting goes through DELETE; an update can only bring a deleted task back.
export const taskUpdateSchema = createUpdateSchema(tasks, {
  ...limitedFields,
  updatedAt: isoDatetime,
})
  .pick({
    id: true,
    updatedAt: true,
    title: true,
    description: true,
    status: true,
    dueDate: true,
    sortOrder: true,
    categoryId: true,
    assigneeId: true,
    editedAt: true,
    completedAt: true,
  })
  .required({ id: true, updatedAt: true })
  .extend({ deletedAt: z.null().optional() })
  .strict();

const list = async (userId: string) =>
  db.query.tasks.findMany({
    where: {
      deletedAt: { isNull: true },
      RAW: (task) =>
        inArray(
          task.id,
          db
            .select({ id: taskAccess.taskId })
            .from(taskAccess)
            .where(eq(taskAccess.userId, userId)),
        ),
    },
    columns: hidden,
    with: {
      user: { columns: { id: true, name: true } },
      subtasks: { where: { deletedAt: { isNull: true } }, columns: hidden },
      shares: {
        with: {
          sharedWithUser: { columns: { id: true, name: true, username: true } },
        },
      },
      assignee: { columns: { id: true, name: true, username: true } },
      sentBy: { columns: { id: true, name: true } },
    },
    orderBy: { sortOrder: "asc", createdAt: "asc" },
  });

/** A deleted task reads as missing, unless asked for by the restore that brings it back. */
const findById = async (id: string, { deleted = false } = {}) => {
  const row = await db.query.tasks.findFirst({
    where: deleted ? { id } : { id, deletedAt: { isNull: true } },
    columns: hidden,
  });
  if (!row) throw new NotFoundError("task", id);
  return row;
};

/** Who can reach these tasks, and how far: a row per way in. */
const accessTo = async (taskIds: string[]) =>
  taskIds.length === 0
    ? []
    : db.select().from(taskAccess).where(inArray(taskAccess.taskId, taskIds));

export type TaskAccessRow = Awaited<ReturnType<typeof accessTo>>[number];

/**
 * The task and who can reach it, in one query; no task when it's missing, or deleted unless asked
 * for. Filtered on the view's task_id, so each branch of task_access is an index lookup.
 */
const findWithAccess = async (id: string, { deleted = false } = {}) => {
  const rows = await db
    .select({
      task: sentColumns,
      taskId: taskAccess.taskId,
      userId: taskAccess.userId,
      canEdit: taskAccess.canEdit,
      canDelete: taskAccess.canDelete,
    })
    .from(taskAccess)
    .innerJoin(tasks, eq(tasks.id, taskAccess.taskId))
    .where(
      deleted ? eq(taskAccess.taskId, id) : and(eq(taskAccess.taskId, id), isNull(tasks.deletedAt)),
    );
  return { task: rows[0]?.task, access: rows.map(({ task: _task, ...access }) => access) };
};

// The stamps a client sends that later writes compare against
const STAMPS = ["updatedAt", "editedAt", "completedAt"] as const;

// A retried insert gets the stored row back unchanged: the no-op update lets RETURNING yield it.
// Re-inserting a deleted task, as Undo did before restores went through update, restores it.
// An id someone else's task already has updates nothing, so it returns nothing and restores nothing.
const insert = async (data: TaskInsert) => {
  const [row] = await db
    .insert(tasks)
    .values({ ...stampsNotAfterNow(data, [...STAMPS]), sortOrder: keptSortOrder(data.sortOrder) })
    .onConflictDoUpdate({
      target: tasks.id,
      set: { updatedAt: sql`${tasks.updatedAt}`, deletedAt: sql`null` },
      setWhere: eq(tasks.userId, data.userId),
    })
    .returning(sentColumns);
  if (!row) throw new IdTakenError("task", data.id);
  return row;
};

// A task sent to someone, which they own. Nothing retries a send with the same id, so any id
// already taken is a conflict, and the sender never gets back a task of the recipient's.
const insertSent = async (data: TaskInsert) => {
  const [row] = await db
    .insert(tasks)
    .values(stampsNotAfterNow(data, [...STAMPS]))
    .onConflictDoNothing()
    .returning(sentColumns);
  if (!row) throw new IdTakenError("task", data.id);
  return row;
};

const update = async (id: string, updatedAt: string, fields: Partial<TaskInsert>) => {
  const at = notAfterNow(updatedAt);
  const [row] = await db
    .update(tasks)
    .set({
      ...stampsNotAfterNow(fields, [...STAMPS]),
      sortOrder: keptSortOrder(fields.sortOrder),
      updatedAt: at,
    })
    .where(and(eq(tasks.id, id), lt(tasks.updatedAt, at)))
    .returning(sentColumns);
  if (!row) throw new StaleUpdateError("task", id);
  return row;
};

// Leaves updatedAt, the sync clock, alone: a note or subtask changing must not beat a pending
// edit to the task itself. Undefined when the task was already edited later than `at`.
const markEdited = async (id: string, editedAt: string) => {
  const at = notAfterNow(editedAt);
  const [row] = await db
    .update(tasks)
    .set({ editedAt: at })
    .where(
      and(
        eq(tasks.id, id),
        isNull(tasks.deletedAt),
        or(isNull(tasks.editedAt), lt(tasks.editedAt, at)),
      ),
    )
    .returning(sentColumns);
  return row;
};

// After the user's other top-level tasks, where the app puts a task they add themselves
const nextSortOrder = async (userId: string) => {
  const last = await db.query.tasks.findFirst({
    where: { userId, parentId: { isNull: true }, sortOrder: { isNotNull: true } },
    columns: { sortOrder: true },
    orderBy: { sortOrder: "desc" },
  });
  return keyAfter([last?.sortOrder]);
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
    .returning(sentColumns);
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
      updatedAt: sql`max(${tasks.updatedAt}, ${notAfterNow(updatedAt)})`,
    })
    .where(eq(tasks.id, id))
    .returning(sentColumns);
  if (!row) throw new NotFoundError("task", id);
  return row;
};

const listItemWith = {
  user: { columns: { id: true, name: true } },
  subtasks: { where: { deletedAt: { isNull: true } }, columns: hidden },
  shares: {
    with: {
      sharedWithUser: { columns: { id: true, name: true, username: true } },
    },
  },
  assignee: { columns: { id: true, name: true, username: true } },
  sentBy: { columns: { id: true, name: true } },
} as const;

/** A task in the shape the list sends, for broadcasting one that's back. */
const findListItem = async (id: string) => {
  const row = await db.query.tasks.findFirst({
    where: { id, deletedAt: { isNull: true } },
    columns: hidden,
    with: listItemWith,
  });
  if (!row) throw new NotFoundError("task", id);
  return row;
};

/** A task as the list sends it, with its subtasks as rows of their own. */
const findListItemWithSubtasks = async (id: string) =>
  db.query.tasks.findMany({
    where: { OR: [{ id }, { parentId: id }], deletedAt: { isNull: true } },
    columns: hidden,
    with: listItemWith,
  });

const findListItems = async (ids: string[]) => {
  if (ids.length === 0) return [];
  return db.query.tasks.findMany({
    where: { id: { in: ids }, deletedAt: { isNull: true } },
    columns: hidden,
    with: listItemWith,
  });
};

export type TaskWithRelations = Awaited<ReturnType<typeof list>>[number];

/** The share, and whether it's new: sharing a task with someone again changes nothing. */
/** Sharing again with someone it's already shared with changes only its permission. */
const insertShare = async (data: TaskShareInsert) => {
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

const findShare = async (id: string) => {
  const row = await db.query.taskShares.findFirst({ where: { id } });
  if (!row) throw new NotFoundError("task share", id);
  return row;
};

const removeShare = async (id: string) => {
  const [row] = await db.delete(taskShares).where(eq(taskShares.id, id)).returning();
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
  if (!row) throw new NotFoundError("task shared with you", taskId);
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
  accessTo,
  findWithAccess,
  findListItemWithSubtasks,
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
  findShare,
  removeShare,
  updateShareCategory,
  listSharesForTasks,
  findOverdue,
};
